import { gsap } from 'gsap'
import { accepted, bounce, captions, down, draw, drawable, dropAt, packet, pulse, show, swap, travel, up } from './kit/anim'
import { createLive } from './kit/live'
import { chipRow, connectorLabel, statusChip, type Tone, type ToneChip, toneTo } from './kit/parts'
import { defineScene, type SceneBuild } from './kit/scene'
import { type Canvas, connector, type Connector, node, type Node, type Point, type Stage } from './kit/stage'

// The Vapi agency-routing topology, defined once, run three ways:
//
//   live      the demo page's bottom pane: `createLiveScene` builds the components and a live driver
//             (`scene.live`) that the page feeds from the app's delivery log and /api/flow;
//   scripted  five scenes with captions (a call with its async tool, two clients, duplicate dropped,
//             bad signature, app down then retry), each with a desktop layout (1920x1080) and a
//             portrait layout for phones (640 wide), the same steps and captions. The website embeds
//             them with `steppedDiagram` in its voice-ai set, so the scene names carry a `vapi-`
//             prefix; the capture script renders them to MP4;
//   detail    clicking a node or packet fills the pane's detail strip (host code, not here).
//
// The agency runs one Vapi assistant per client. Each assistant sends its call webhooks to that
// client's own Event Gateway source (edges `in_*`), Event Gateway delivers them through
// `hookdeck listen` (edges `out_*`) to the client's endpoint in the demo app (edges `local_*`).
// The async tool's result goes back into the live call on a fourth edge, from the endpoint to the
// call's `controlUrl` in Vapi (edges `return_*`).
//
// No host code in this file: it imports gsap and the kit, nothing else.

// ---- Facts the scenes show, with their evidence (handoffs/.../demos/vapi.md; scripts/setup.ts) ----

export const facts = {
  /** status-update (in-progress) body, both live calls of 2026-11-11: 5.5 KB. */
  statusSize: '5.5 KB',
  /** tool-calls body: Acme's call 8.4 KB, Globex's 8.5 KB. */
  toolCallsSize: '8.4 KB',
  globexToolCallsSize: '8.5 KB',
  /** status-update (ended): Acme's ~100 s call 18.2 KB, Globex's ~43 s call 10.5 KB (grows with the call). */
  endedSize: '18.2 KB',
  /** end-of-call-report with the transcript: Acme's call 39.2 KB, Globex's 22.8 KB. */
  reportSize: '39.2 KB',
  /** The demo app's stand-in CRM lookup (LOOKUP_DELAY_MS, default 6000). */
  lookupSeconds: 6,
  /** Header the Vapi credential signs each webhook with (bare hex HMAC-SHA256 of the body). */
  signatureHeader: 'x-signature',
  /** Dedup rule in scripts/setup.ts: the same message type, call, status and tool calls inside the window. */
  dedupWindowMinutes: 10,
  /** Retry rule in scripts/setup.ts: exponential, 4 retries, first interval 10 s. */
  retryFirstSeconds: 10,
  retryCount: 4,
  /** The app's failure switch answers 503 (src/server.ts). */
  failStatus: 503,
  /** What Event Gateway answers Vapi when verification fails (probe, 2026-11-12). */
  rejectStatus: 401,
} as const

// One whole sentence per resting state: the opening state, then each step. Terms in backticks
// render as code on the website.
export const captionsBy = {
  'vapi-call-and-tool': [
    'Each client has its own Vapi assistant, its own Event Gateway source and its own endpoint in the demo app. This call is to Acme Dental.',
    `The caller connects. Vapi sends \`status-update\` (${facts.statusSize}) to the Acme Dental source, and Event Gateway delivers it through \`hookdeck listen\` to the Acme endpoint. Globex Plumbing receives nothing.`,
    `The caller gives a name and the assistant calls \`lookup_customer\`, an async tool. Vapi sends \`tool-calls\` (${facts.toolCallsSize}) by the same route, and the endpoint answers at once without a result.`,
    `About ${facts.lookupSeconds} seconds later the endpoint finishes its lookup and posts the result to the call's \`controlUrl\` in Vapi. The assistant speaks it.`,
    `When the caller hangs up, Vapi sends \`status-update\` (ended, ${facts.endedSize}) and then \`end-of-call-report\` (${facts.reportSize}, with the transcript) by the same route.`,
  ],
  'vapi-two-clients': [
    'Acme Dental and Globex Plumbing each have a Vapi assistant. Each assistant\'s Server URL is that client\'s own Event Gateway source.',
    `A caller reaches Acme Dental. Vapi sends \`status-update\` (${facts.statusSize}) to the Acme Dental source, and it is delivered to the Acme endpoint.`,
    `A caller then reaches Globex Plumbing. Its \`status-update\` goes to the Globex Plumbing source and on to the Globex endpoint. The Acme endpoint does not see it.`,
    `Each assistant calls \`lookup_customer\`. The \`tool-calls\` (${facts.toolCallsSize} and ${facts.globexToolCallsSize}) follow the same routes, each to its own client's endpoint.`,
    'Each endpoint posts its result to the `controlUrl` of its own call, so Acme\'s result reaches Acme\'s caller and Globex\'s reaches Globex\'s.',
  ],
  'vapi-duplicate-dropped': [
    'The Acme endpoint has handled this call\'s `end-of-call-report`.',
    'Vapi sends the same `end-of-call-report` again, because senders can deliver a message more than once.',
    `Event Gateway sees the same \`end-of-call-report\` for the same call inside the ${facts.dedupWindowMinutes} minute window and drops it. Vapi still gets a 200.`,
    'Nothing is forwarded, so the endpoint is not called a second time.',
  ],
  'vapi-bad-signature': [
    'A request claims to come from Vapi, but its signature was made with the wrong secret.',
    `Event Gateway receives the request and checks \`${facts.signatureHeader}\` against the source's secret.`,
    'Verification fails. The request is recorded as `VERIFICATION_FAILED` and no event is created.',
    `Event Gateway answers the sender with a ${facts.rejectStatus}, and the endpoint is never called.`,
  ],
  'vapi-app-down': [
    `The Acme endpoint is down: it answers every delivery with a ${facts.failStatus}.`,
    'The call ends and Vapi sends `end-of-call-report`. Event Gateway stores it and answers Vapi with a 200.',
    `Event Gateway delivers it through \`hookdeck listen\`. Attempt 1 gets a ${facts.failStatus} from the endpoint.`,
    `Event Gateway keeps the event and retries with exponential backoff: the first retry is ${facts.retryFirstSeconds} seconds after the failed attempt, then it waits longer each time, up to ${facts.retryCount} retries.`,
    `The endpoint recovers. Attempt 2 succeeds about ${facts.retryFirstSeconds} seconds later, and the event is delivered once.`,
  ],
} as const

export type ScenarioId = keyof typeof captionsBy

// ---- Layouts: where the components sit ----

type ClientId = 'acme' | 'globex'
const CLIENT_IDS: ClientId[] = ['acme', 'globex']
const CLIENT_NAMES: Record<ClientId, string> = { acme: 'Acme Dental', globex: 'Globex Plumbing' }
const ENDPOINT_NAMES: Record<ClientId, string> = { acme: 'Acme endpoint', globex: 'Globex endpoint' }

interface Box { x: number, y: number, w: number, h: number }

interface Layout {
  canvas: Canvas
  dir: 'h' | 'v'
  /** Node scale for the client nodes and for the shared (gateway, listen) nodes. */
  k_client: number
  k_shared: number
  agent: Record<ClientId, Box>
  app: Record<ClientId, Box>
  gateway: Box
  listen: Box
  /** Where each node's status chip sits, relative to the node's center. */
  status: { agent: Record<ClientId, Point>, app: Record<ClientId, Point>, gateway: Point, listen: Point }
  chips: Point
  chip_size: number
  edgeLabels: { in: Record<ClientId, Point>, out: Record<ClientId, Point>, local: Record<ClientId, Point>, return: Record<ClientId, Point | null> }
  /** How far each return connector bulges out of the layout (signed: up/left is negative). */
  returnBulge: Record<ClientId, number>
  caption: { x: number, y: number, max: number, size: number }
  /** The part of the canvas the diagram uses, for a page that crops to it (SVG viewBox). */
  crop: string
}

const DESKTOP: Layout = {
  canvas: { width: 1920, height: 1080 },
  dir: 'h',
  k_client: 0.8,
  k_shared: 1,
  agent: { acme: { x: 195, y: 250, w: 330, h: 130 }, globex: { x: 195, y: 520, w: 330, h: 130 } },
  app: { acme: { x: 1710, y: 250, w: 330, h: 130 }, globex: { x: 1710, y: 520, w: 330, h: 130 } },
  gateway: { x: 690, y: 385, w: 380, h: 380 },
  listen: { x: 1215, y: 385, w: 400, h: 380 },
  status: {
    // Acme's connector to Vapi loops over the top, Globex's under the bottom, so the chips sit between the rows.
    agent: { acme: { x: 0, y: 100 }, globex: { x: 0, y: -100 } },
    app: { acme: { x: 0, y: 100 }, globex: { x: 0, y: -100 } },
    gateway: { x: 0, y: -240 },
    listen: { x: 0, y: -240 },
  },
  chips: { x: 690, y: 622 },
  chip_size: 20,
  edgeLabels: {
    in: { acme: { x: 440, y: 292 }, globex: { x: 440, y: 562 } },
    out: { acme: { x: 950, y: 292 }, globex: { x: 950, y: 562 } },
    local: { acme: { x: 1470, y: 292 }, globex: { x: 1470, y: 562 } },
    return: { acme: { x: 952, y: 88 }, globex: { x: 952, y: 682 } },
  },
  returnBulge: { acme: -130, globex: 130 },
  caption: { x: 60, y: 800, max: 78, size: 38 },
  crop: '30 55 1860 655',
}

const PHONE: Layout = {
  canvas: { width: 640, height: 1000 },
  dir: 'v',
  k_client: 0.55,
  k_shared: 0.7,
  agent: { acme: { x: 195, y: 115, w: 220, h: 110 }, globex: { x: 445, y: 115, w: 220, h: 110 } },
  app: { acme: { x: 195, y: 870, w: 220, h: 110 }, globex: { x: 445, y: 870, w: 220, h: 110 } },
  gateway: { x: 320, y: 360, w: 480, h: 250 },
  listen: { x: 320, y: 650, w: 480, h: 120 },
  status: {
    agent: { acme: { x: 0, y: -85 }, globex: { x: 0, y: -85 } },
    app: { acme: { x: 0, y: 85 }, globex: { x: 0, y: 85 } },
    // Inside the cards, so the status chips don't cover the connector labels.
    gateway: { x: 0, y: -88 },
    listen: { x: 0, y: -85 },
  },
  chips: { x: 320, y: 448 },
  chip_size: 16,
  edgeLabels: {
    in: { acme: { x: 195, y: 203 }, globex: { x: 445, y: 203 } },
    out: { acme: { x: 195, y: 537 }, globex: { x: 445, y: 537 } },
    local: { acme: { x: 195, y: 762 }, globex: { x: 445, y: 762 } },
    return: { acme: null, globex: null },
  },
  returnBulge: { acme: -55, globex: 55 },
  caption: { x: 0, y: 0, max: 0, size: 0 },
  crop: '0 0 640 1000',
}

// ---- Components ----

const CAPABILITIES = [
  { id: 'verify', label: 'Verify' },
  { id: 'store', label: 'Store' },
  { id: 'dedup', label: 'Dedup' },
  { id: 'retry', label: 'Retry' },
] as const

type NodeId = 'agent_acme' | 'agent_globex' | 'gateway' | 'listen' | 'app_acme' | 'app_globex'
type EdgeId = `${'in' | 'out' | 'local' | 'return'}_${ClientId}`

interface Parts {
  nodes: Record<NodeId, Node>
  edges: Record<EdgeId, Connector>
  edgeLabels: Partial<Record<EdgeId, SVGGElement>>
  chips: Record<string, ToneChip>
}

/**
 * The connector from an endpoint back to its call in Vapi: it leaves the endpoint, loops around the
 * layout (over or under the rows on desktop, beside the columns on phones) and arrives at the
 * assistant. `connector()` styles the path; the loop replaces its geometry. A signed `bulge`: up or
 * left is negative.
 */
function loopConnector(stage: Stage, from: Point, to: Point, dir: 'h' | 'v', bulge: number): Connector {
  const base = connector(stage, from, to, dir)
  const d = dir === 'h'
    ? `M ${from.x} ${from.y} C ${from.x} ${from.y + bulge}, ${to.x} ${to.y + bulge}, ${to.x} ${to.y}`
    : `M ${from.x} ${from.y} C ${from.x + bulge} ${from.y}, ${to.x + bulge} ${to.y}, ${to.x} ${to.y}`
  base.path.setAttribute('d', d)
  return { path: base.path, d, length: base.path.getTotalLength(), dir: 'h' }
}

function buildParts(build: Pick<SceneBuild, 'stage'>, layout: Layout): Parts {
  const { stage } = build
  const L = layout
  const nodes = {} as Record<NodeId, Node>
  for (const id of CLIENT_IDS) {
    nodes[`agent_${id}`] = node(stage, { ...L.agent[id], eyebrow: 'Vapi assistant', title: CLIENT_NAMES[id], icon: 'mic', scale: L.k_client, status: L.status.agent[id] })
    nodes[`app_${id}`] = node(stage, { ...L.app[id], eyebrow: 'Localhost', title: ENDPOINT_NAMES[id], icon: 'dns', scale: L.k_client, status: L.status.app[id] })
  }
  nodes.gateway = node(stage, { ...L.gateway, eyebrow: 'Hookdeck', title: 'Event Gateway', icon: 'hookdeck', variant: 'work', scale: L.k_shared, status: L.status.gateway })
  nodes.listen = node(stage, { ...L.listen, eyebrow: 'Hookdeck CLI', title: 'hookdeck listen', icon: 'terminal', scale: L.k_shared, status: L.status.listen })

  // Where a client's connector meets a tall shared node: on the client's row (desktop) or column (phone).
  const at = (n: Node, side: 'left' | 'right' | 'top' | 'bottom', client: Box): Point =>
    L.dir === 'h' ? { x: n[side].x, y: client.y } : { x: client.x, y: n[side].y }
  const edges = {} as Record<EdgeId, Connector>
  const edgeLabels: Partial<Record<EdgeId, SVGGElement>> = {}
  for (const id of CLIENT_IDS) {
    const agent = nodes[`agent_${id}`]
    const app = nodes[`app_${id}`]
    const [out_a, out_b] = L.dir === 'h' ? (['right', 'left'] as const) : (['bottom', 'top'] as const)
    edges[`in_${id}`] = connector(stage, agent[out_a], at(nodes.gateway, out_b, L.agent[id]), L.dir)
    edges[`out_${id}`] = connector(stage, at(nodes.gateway, out_a, L.agent[id]), at(nodes.listen, out_b, L.agent[id]), L.dir)
    edges[`local_${id}`] = connector(stage, at(nodes.listen, out_a, L.agent[id]), app[out_b], L.dir)
    // Acme's return loop runs over the top (left on phones), Globex's under the bottom (right).
    const side = id === 'acme' ? (L.dir === 'h' ? 'top' : 'left') : (L.dir === 'h' ? 'bottom' : 'right')
    edges[`return_${id}`] = loopConnector(stage, app[side], agent[side], L.dir, L.returnBulge[id])
    edgeLabels[`in_${id}`] = connectorLabel(stage, { ...L.edgeLabels.in[id], label: 'POST' })
    edgeLabels[`out_${id}`] = connectorLabel(stage, { ...L.edgeLabels.out[id], label: 'WSS' })
    edgeLabels[`local_${id}`] = connectorLabel(stage, { ...L.edgeLabels.local[id], label: 'HTTP' })
    const return_at = L.edgeLabels.return[id]
    if (return_at) edgeLabels[`return_${id}`] = connectorLabel(stage, { ...return_at, label: 'controlUrl' })
  }
  const chips = chipRow(stage.overlay, { ...L.chips, items: [...CAPABILITIES], size: L.chip_size, gap: L.dir === 'h' ? 14 : 8 })
  return { nodes, edges, edgeLabels, chips }
}

/** The state every scene opens on: components on stage, connectors drawn. Hidden until `introAnimation`. */
function hideForIntro(parts: Parts) {
  for (const n of Object.values(parts.nodes))
    gsap.set(n.g, { autoAlpha: 0 })
  for (const e of Object.values(parts.edges))
    drawable(e.path)
  for (const l of Object.values(parts.edgeLabels))
    gsap.set(l, { autoAlpha: 0 })
  for (const c of Object.values(parts.chips))
    gsap.set(c.g, { autoAlpha: 0 })
}

function introAnimation(tl: gsap.core.Timeline, parts: Parts): number {
  const order: NodeId[] = ['agent_acme', 'agent_globex', 'gateway', 'listen', 'app_acme', 'app_globex']
  order.forEach((id, i) => show(tl, parts.nodes[id].g, 0.15 + i * 0.14))
  const edge_order: EdgeId[] = ['in_acme', 'in_globex', 'out_acme', 'out_globex', 'local_acme', 'local_globex', 'return_acme', 'return_globex']
  edge_order.forEach((id, i) => {
    draw(tl, parts.edges[id].path, 0.55 + i * 0.12, 0.5)
    const label = parts.edgeLabels[id]
    if (label) show(tl, label, 0.95 + i * 0.12)
  })
  return Math.max(show(tl, Object.values(parts.chips).map(c => c.g), 1.0), 1.9)
}

// ---- Scripted helpers ----

interface Ctx {
  stage: SceneBuild['stage']
  tl: gsap.core.Timeline
  parts: Parts
  /** Status chips by node: `set` crossfades to a new chip. */
  status: Record<NodeId, { set: (at: number, label: string, tone?: Tone) => number }>
  caption: ReturnType<typeof captions>
}

function makeCtx(b: SceneBuild, parts: Parts, layout: Layout, id: ScenarioId): Ctx {
  const { tl, stage } = b
  const size = layout.dir === 'h' ? 21 : 17
  const status = {} as Ctx['status']
  for (const key of Object.keys(parts.nodes) as NodeId[]) {
    let current: SVGGElement | null = null
    status[key] = {
      set(at, label, tone = 'neutral') {
        const chip = statusChip(stage, parts.nodes[key], label, tone, size)
        const t = swap(tl, current, chip, at)
        current = chip
        return t
      },
    }
  }
  const caption = captions(stage, [...captionsBy[id]], { x: layout.caption.x, y: layout.caption.y }, b.options.captions && layout.dir === 'h', { max: layout.caption.max, size: layout.caption.size })
  return { stage, tl, parts, status, caption }
}

/** Sends a packet along an edge. Returns the time it arrives. */
function send(c: Ctx, edge: EdgeId, at: number, o: { label?: string, big?: boolean, end?: 'into' | 'arrive' }): number {
  const p = packet(c.stage, c.parts.edges[edge], { big: o.big, label: o.label })
  return travel(c.tl, p, at, o.end ?? 'into', o.big ? 1.9 : 1.2)
}

/** Capability chips do their work: tone and a pulse. */
function work(c: Ctx, ids: string[], tone: Tone, at: number): number {
  let t = at
  for (const id of ids) {
    toneTo(c.tl, c.parts.chips[id], tone, t)
    pulse(c.tl, c.parts.chips[id].g, t)
    t += 0.4
  }
  return t
}

function resetChips(c: Ctx, at: number) {
  for (const chip of Object.values(c.parts.chips))
    toneTo(c.tl, chip, 'neutral', at)
}

/** One webhook's whole delivery for a client: in to Event Gateway (verify and store), out to the CLI, local to the client's endpoint. Returns the time the endpoint has it. */
function deliver(c: Ctx, at: number, who: ClientId, label: string, lead: { text: string, tone?: Tone }): number {
  let t = send(c, `in_${who}`, at, { label })
  c.status[`agent_${who}`].set(t - 0.1, 'sent', 'blue')
  t = work(c, ['verify', 'store'], 'success', t)
  c.status.gateway.set(t - 0.3, 'verified · stored', 'success')
  c.status[`agent_${who}`].set(t, 'got 200', 'success')
  t = send(c, `out_${who}`, t, { label })
  c.status.listen.set(t - 0.2, 'forwarding', 'blue')
  t = send(c, `local_${who}`, t, { label })
  accepted(c.tl, c.parts.nodes[`app_${who}`], t - 0.15)
  c.status.listen.set(t, 'connected')
  return c.status[`app_${who}`].set(t, lead.text, lead.tone ?? 'success')
}

/** The endpoint's result going back into the live call: a packet along the `controlUrl` edge. */
function returnResult(c: Ctx, at: number, who: ClientId): number {
  c.status[`app_${who}`].set(at + 0.1, 'result ready', 'blue')
  const t = send(c, `return_${who}`, at, { label: 'add-message' })
  return c.status[`agent_${who}`].set(t - 0.1, 'result spoken', 'success')
}

// Packet labels are short: the connectors between nodes are short.
const IN_PROGRESS = `in-progress ${facts.statusSize}`
const TOOL_CALLS = `tool-calls ${facts.toolCallsSize}`
const GLOBEX_TOOL_CALLS = `tool-calls ${facts.globexToolCallsSize}`
const ENDED = `ended ${facts.endedSize}`
const REPORT = `report ${facts.reportSize}`

// ---- The scenarios ----

const scenarios: Record<ScenarioId, (b: SceneBuild, c: Ctx) => void> = {
  'vapi-call-and-tool': (b, c) => {
    const { tl } = c
    b.intro(() => introAnimation(tl, c.parts))
    b.step((at) => {
      c.caption.to(tl, 1, at)
      c.status.app_globex.set(at + 0.1, 'nothing received', 'neutral')
      return deliver(c, at, 'acme', IN_PROGRESS, { text: 'In call' })
    })
    b.step((at) => {
      c.caption.to(tl, 2, at)
      resetChips(c, at)
      return deliver(c, at + 0.2, 'acme', TOOL_CALLS, { text: 'Looking up', tone: 'blue' })
    })
    b.step((at) => {
      c.caption.to(tl, 3, at)
      resetChips(c, at)
      return returnResult(c, at + 0.2, 'acme')
    })
    b.step((at) => {
      c.caption.to(tl, 4, at)
      resetChips(c, at)
      const t = deliver(c, at + 0.2, 'acme', ENDED, { text: 'Call ended' })
      resetChips(c, t)
      return deliver(c, t + 0.2, 'acme', REPORT, { text: 'Report stored' })
    })
  },

  'vapi-two-clients': (b, c) => {
    const { tl } = c
    b.intro(() => introAnimation(tl, c.parts))
    b.step((at) => {
      c.caption.to(tl, 1, at)
      return deliver(c, at, 'acme', IN_PROGRESS, { text: 'In call' })
    })
    b.step((at) => {
      c.caption.to(tl, 2, at)
      resetChips(c, at)
      return deliver(c, at + 0.2, 'globex', IN_PROGRESS, { text: 'In call' })
    })
    b.step((at) => {
      c.caption.to(tl, 3, at)
      resetChips(c, at)
      const t = deliver(c, at + 0.2, 'acme', TOOL_CALLS, { text: 'Looking up', tone: 'blue' })
      resetChips(c, t)
      return deliver(c, t + 0.1, 'globex', GLOBEX_TOOL_CALLS, { text: 'Looking up', tone: 'blue' })
    })
    b.step((at) => {
      c.caption.to(tl, 4, at)
      resetChips(c, at)
      const t = returnResult(c, at + 0.2, 'acme')
      return Math.max(t, returnResult(c, at + 0.7, 'globex'))
    })
  },

  'vapi-duplicate-dropped': (b, c) => {
    const { tl } = c
    let again: ReturnType<typeof packet>
    b.intro(() => {
      const t = introAnimation(tl, c.parts)
      accepted(tl, c.parts.nodes.app_acme, t - 0.2)
      c.status.app_acme.set(t - 0.1, 'Report stored', 'success')
      return c.status.gateway.set(t, 'verified · stored', 'success')
    })
    b.step((at) => {
      c.caption.to(tl, 1, at)
      // The repeat stops at Event Gateway and stays there until step 2.
      again = packet(c.stage, c.parts.edges.in_acme, { label: REPORT })
      const t = travel(tl, again, at, 'arrive', 1.2)
      return c.status.agent_acme.set(t - 0.1, 'sent again', 'blue')
    })
    b.step((at) => {
      c.caption.to(tl, 2, at)
      dropAt(tl, again, at + 0.3)
      const t = work(c, ['dedup'], 'warn', at + 0.1)
      c.status.gateway.set(t - 0.3, 'duplicate · dropped', 'warn')
      return c.status.agent_acme.set(t, 'got 200', 'success')
    })
    b.step((at) => {
      c.caption.to(tl, 3, at)
      return c.status.listen.set(at + 0.2, 'nothing to forward', 'neutral')
    })
  },

  'vapi-bad-signature': (b, c) => {
    const { tl } = c
    let forged: ReturnType<typeof packet>
    b.intro(() => introAnimation(tl, c.parts))
    b.step((at) => {
      c.caption.to(tl, 1, at)
      forged = packet(c.stage, c.parts.edges.in_acme, { label: 'bad signature' })
      const t = travel(tl, forged, at, 'arrive', 1.2)
      return c.status.agent_acme.set(t - 0.1, 'sent', 'blue')
    })
    b.step((at) => {
      c.caption.to(tl, 2, at)
      const t = work(c, ['verify'], 'danger', at + 0.1)
      down(tl, c.parts.nodes.gateway, at + 0.1)
      dropAt(tl, forged, at + 0.3, true)
      return c.status.gateway.set(t - 0.2, 'verification failed', 'danger')
    })
    b.step((at) => {
      c.caption.to(tl, 3, at)
      c.status.agent_acme.set(at + 0.1, `got ${facts.rejectStatus}`, 'danger')
      return c.status.app_acme.set(at + 0.2, 'never called', 'neutral')
    })
  },

  'vapi-app-down': (b, c) => {
    const { tl } = c
    b.intro(() => {
      const t = introAnimation(tl, c.parts)
      down(tl, c.parts.nodes.app_acme, t - 0.2)
      return c.status.app_acme.set(t, `answering ${facts.failStatus}`, 'danger')
    })
    b.step((at) => {
      c.caption.to(tl, 1, at)
      let t = send(c, 'in_acme', at, { label: REPORT })
      c.status.agent_acme.set(t - 0.1, 'sent', 'blue')
      t = work(c, ['verify', 'store'], 'success', t)
      c.status.gateway.set(t - 0.3, 'verified · stored', 'success')
      return c.status.agent_acme.set(t, 'got 200', 'success')
    })
    b.step((at) => {
      c.caption.to(tl, 2, at)
      let t = send(c, 'out_acme', at, { label: REPORT })
      c.status.listen.set(t - 0.2, 'forwarding', 'blue')
      const attempt = packet(c.stage, c.parts.edges.local_acme, { label: REPORT })
      t = travel(tl, attempt, t, 'arrive', 1.2)
      bounce(tl, attempt, t)
      c.status.app_acme.set(t, `attempt 1 · ${facts.failStatus}`, 'danger')
      return c.status.gateway.set(t + 0.3, 'attempt 1 failed', 'danger')
    })
    b.step((at) => {
      c.caption.to(tl, 3, at)
      const t = work(c, ['retry'], 'warn', at + 0.1)
      return c.status.gateway.set(t, `retry in ${facts.retryFirstSeconds} s`, 'warn')
    })
    b.step((at) => {
      c.caption.to(tl, 4, at)
      up(tl, c.parts.nodes.app_acme, at)
      c.status.app_acme.set(at, 'recovered', 'success')
      let t = send(c, 'out_acme', at + 0.5, { label: REPORT })
      c.status.listen.set(t, 'connected')
      t = send(c, 'local_acme', t, { label: REPORT })
      accepted(tl, c.parts.nodes.app_acme, t - 0.15)
      toneTo(tl, c.parts.chips.retry, 'success', t)
      c.status.gateway.set(t, 'delivered · attempt 2', 'success')
      return c.status.app_acme.set(t, 'handled · attempt 2', 'success')
    })
  },
}

// ---- Scene factories ----

function scripted(id: ScenarioId, layout: Layout, name: string) {
  return defineScene(name, (b) => {
    const parts = buildParts(b, layout)
    hideForIntro(parts)
    const c = makeCtx(b, parts, layout, id)
    scenarios[id](b, c)
  }, { canvas: layout.canvas })
}

export const createCallAndToolScene = scripted('vapi-call-and-tool', DESKTOP, 'vapi-call-and-tool')
export const createCallAndToolMobileScene = scripted('vapi-call-and-tool', PHONE, 'vapi-call-and-tool-mobile')
export const createTwoClientsScene = scripted('vapi-two-clients', DESKTOP, 'vapi-two-clients')
export const createTwoClientsMobileScene = scripted('vapi-two-clients', PHONE, 'vapi-two-clients-mobile')
export const createDuplicateScene = scripted('vapi-duplicate-dropped', DESKTOP, 'vapi-duplicate-dropped')
export const createDuplicateMobileScene = scripted('vapi-duplicate-dropped', PHONE, 'vapi-duplicate-dropped-mobile')
export const createBadSignatureScene = scripted('vapi-bad-signature', DESKTOP, 'vapi-bad-signature')
export const createBadSignatureMobileScene = scripted('vapi-bad-signature', PHONE, 'vapi-bad-signature-mobile')
export const createAppDownScene = scripted('vapi-app-down', DESKTOP, 'vapi-app-down')
export const createAppDownMobileScene = scripted('vapi-app-down', PHONE, 'vapi-app-down-mobile')

// The captions arrays the website's sync reads (strings only).
export const callAndToolCaptions = captionsBy['vapi-call-and-tool']
export const twoClientsCaptions = captionsBy['vapi-two-clients']
export const duplicateCaptions = captionsBy['vapi-duplicate-dropped']
export const badSignatureCaptions = captionsBy['vapi-bad-signature']
export const appDownCaptions = captionsBy['vapi-app-down']

/** Per-scene crop of the desktop canvas (SVG viewBox), for a page that shows the diagram without the empty slide around it. */
export const desktopCrop = DESKTOP.crop

/**
 * The live scene: the same components, no steps. Everything is on stage from the start, and
 * `scene.live` (a LiveDriver) launches packets and sets badges as the page's feeds report events.
 * Node ids: agent_acme, agent_globex, gateway, listen, app_acme, app_globex. Edge ids: in_*, out_*,
 * local_*, return_* (acme or globex). Chip ids: verify, store, dedup, retry.
 */
function live(layout: Layout, name: string) {
  return defineScene(name, (b) => {
    const parts = buildParts(b, layout)
    b.live(createLive({ stage: b.stage, nodes: parts.nodes, edges: parts.edges, chips: parts.chips }))
    for (const l of Object.values(parts.edgeLabels))
      gsap.set(l, { autoAlpha: 1 })
    for (const c of Object.values(parts.chips))
      gsap.set(c.g, { autoAlpha: 1 })
  }, { canvas: layout.canvas })
}

export const createLiveScene = live(DESKTOP, 'live')
export const createLiveMobileScene = live(PHONE, 'live-mobile')

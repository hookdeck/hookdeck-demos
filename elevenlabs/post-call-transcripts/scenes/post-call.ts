import { gsap } from 'gsap'
import { accepted, bounce, captions, down, draw, drawable, dropAt, packet, pulse, show, swap, travel, up } from './kit/anim'
import { createLive } from './kit/live'
import { chipRow, connectorLabel, statusChip, type Tone, type ToneChip, toneTo } from './kit/parts'
import { defineScene, type SceneBuild } from './kit/scene'
import { type Canvas, connector, type Connector, node, type Node, type Point } from './kit/stage'

// The ElevenLabs post-call webhook topology, defined once, run three ways:
//
//   live      the demo page's hero view: `createLiveScene` builds the components and a live driver
//             (`scene.live`) that the page feeds from /api/flow;
//   scripted  four scenes with captions (delivery, duplicate, bad signature, app down), each with
//             a desktop layout (1920x1080) and a portrait layout for phones (640 wide), the same
//             steps and captions. The website embeds them with its `steppedDiagram` component;
//             the capture script renders them to GIF and MP4;
//   detail    clicking a node or packet opens the page's flow drawer (host code, not here).
//
// No host code in this file: it imports gsap and the kit, nothing else.

// ---- Facts the scenes show, with their evidence (handoffs/.../demos/elevenlabs.md; setup.ts) ----

export const facts = {
  /** post_call_transcription for a real call. */
  transcriptSize: '53 KB',
  /** post_call_audio for a real call. */
  audioSize: '3.5 MB',
  /** Header ElevenLabs signs each webhook with. */
  signatureHeader: 'ElevenLabs-Signature',
  /** Dedup rule: the same event type for the same conversation inside the window. */
  dedupFields: 'type + conversation_id',
  /** Retry rule: linear, 5 retries, 10 seconds apart. */
  retryIntervalSeconds: 10,
  retryCount: 5,
} as const

// One whole sentence per resting state: the opening state, then each step. Terms in backticks
// render as code on the website.
export const captionsBy = {
  'delivery': [
    'When a call ends, ElevenLabs sends two webhooks: the transcript, then the audio. Event Gateway sits between ElevenLabs and your app.',
    `ElevenLabs posts \`post_call_transcription\` (${facts.transcriptSize}) to the Event Gateway source.`,
    `Event Gateway checks the \`${facts.signatureHeader}\`, stores the request and answers ElevenLabs with a 200.`,
    '`hookdeck listen` receives the event from Event Gateway and hands it to your app on localhost, which stores the conversation.',
    `\`post_call_audio\` (${facts.audioSize}) follows a second later and takes the same path.`,
  ],
  'duplicate': [
    'Your app has stored this call\'s transcript once.',
    'ElevenLabs sends the same `post_call_transcription` again, because senders can deliver an event more than once.',
    `Event Gateway sees the same \`${facts.dedupFields}\` inside the dedup window and drops it. ElevenLabs still gets a 200.`,
    'Nothing is forwarded: your app is not called a second time.',
  ],
  'bad-signature': [
    'A request claims to come from ElevenLabs, but its signature was made with the wrong secret.',
    'Event Gateway accepts the request, then checks its signature.',
    `Verification of \`${facts.signatureHeader}\` fails. The request is recorded as \`VERIFICATION_FAILED\` and no event is created.`,
    'The sender still gets a 200, and your app is never called.',
  ],
  'app-down': [
    'Your app is down: it answers every delivery with a 500.',
    'A `post_call_transcription` arrives. Event Gateway verifies it and stores it, as it always does.',
    'Event Gateway delivers it through `hookdeck listen`. Attempt 1 gets a 500 from your app.',
    `Event Gateway keeps the event and retries on a schedule: every ${facts.retryIntervalSeconds} seconds, up to ${facts.retryCount} times.`,
    'Your app recovers. Attempt 2 succeeds, and the event is delivered once.',
  ],
} as const

// The opening diagram of a tutorial: the flow as it runs once your app is deployed. No
// `hookdeck listen`: Event Gateway delivers to your app's HTTPS endpoint. Not a tab in the demo
// page, which shows what the demo runs.
export const deployedCaptionsBy = [
  'When a call ends, ElevenLabs sends two webhooks: the transcript, then the audio. Event Gateway sits between ElevenLabs and your app, which runs at an HTTPS URL.',
  `ElevenLabs posts \`post_call_transcription\` (${facts.transcriptSize}) to the Event Gateway source.`,
  `Event Gateway checks the \`${facts.signatureHeader}\`, stores the request and answers ElevenLabs with a 200.`,
  'Event Gateway delivers the event to your app over HTTPS and signs the delivery. Your app verifies the Hookdeck signature and stores the conversation.',
  `\`post_call_audio\` (${facts.audioSize}) follows a second later and takes the same path.`,
] as const

export type ScenarioId = keyof typeof captionsBy

// ---- Layouts: where the components sit ----

interface Layout {
  canvas: Canvas
  dir: 'h' | 'v'
  /** Node scale: 1 on both canvases, which are sized so 1 reads on both. */
  k: number
  agent: { x: number, y: number, w: number, h: number }
  gateway: { x: number, y: number, w: number, h: number }
  listen: { x: number, y: number, w: number, h: number }
  app: { x: number, y: number, w: number, h: number }
  /** Where each node's status chip sits, relative to the node's center. */
  status: { agent: Point, gateway: Point, listen: Point, app: Point }
  chips: Point
  edgeLabels: { in: Point, out: Point, local: Point }
  caption: { x: number, y: number, max: number, size: number }
  /** The part of the canvas the diagram uses, for a page that crops to it (SVG viewBox). */
  crop: string
}

const DESKTOP: Layout = {
  canvas: { width: 1920, height: 1080 },
  dir: 'h',
  k: 1,
  agent: { x: 205, y: 470, w: 300, h: 150 },
  gateway: { x: 690, y: 470, w: 390, h: 210 },
  listen: { x: 1225, y: 470, w: 400, h: 150 },
  app: { x: 1715, y: 470, w: 300, h: 150 },
  status: {
    agent: { x: 0, y: 118 },
    gateway: { x: 0, y: -150 },
    listen: { x: 0, y: 118 },
    app: { x: 0, y: 118 },
  },
  chips: { x: 690, y: 624 },
  edgeLabels: { in: { x: 425, y: 512 }, out: { x: 957, y: 512 }, local: { x: 1475, y: 512 } },
  caption: { x: 60, y: 870, max: 78, size: 38 },
  crop: '30 270 1860 420',
}

const PHONE: Layout = {
  canvas: { width: 640, height: 1090 },
  dir: 'v',
  k: 0.9,
  agent: { x: 320, y: 90, w: 440, h: 120 },
  gateway: { x: 320, y: 410, w: 500, h: 170 },
  listen: { x: 320, y: 745, w: 440, h: 120 },
  app: { x: 320, y: 975, w: 440, h: 120 },
  status: {
    agent: { x: 0, y: 100 },
    gateway: { x: 0, y: 180 },
    listen: { x: 0, y: 85 },
    app: { x: 0, y: 85 },
  },
  chips: { x: 320, y: 540 },
  edgeLabels: { in: { x: 320, y: 262 }, out: { x: 320, y: 650 }, local: { x: 320, y: 888 } },
  caption: { x: 0, y: 0, max: 0, size: 0 },
  crop: '0 0 640 1090',
}

// ---- Components ----

const CAPABILITIES = [
  { id: 'verify', label: 'Verify' },
  { id: 'store', label: 'Store' },
  { id: 'dedup', label: 'Dedup' },
  { id: 'retry', label: 'Retry' },
] as const

type NodeId = 'agent' | 'gateway' | 'listen' | 'app'
type EdgeId = 'in' | 'out' | 'local'

interface Parts {
  nodes: Record<NodeId, Node>
  edges: Record<EdgeId, Connector>
  edgeLabels: Record<EdgeId, SVGGElement>
  chips: Record<string, ToneChip>
}

/**
 * The `tutorial` flag is set by the website for the step diagrams of the guide: the app is "Your
 * app" there, because the reader runs their own. The demo page leaves it off and keeps "Demo app".
 */
function buildParts(build: Pick<SceneBuild, 'stage' | 'options'>, layout: Layout): Parts {
  const { stage } = build
  const L = layout
  const nodes: Record<NodeId, Node> = {
    agent: node(stage, { ...L.agent, eyebrow: 'ElevenLabs', title: 'Voice agent', icon: 'mic', scale: L.k, status: L.status.agent }),
    gateway: node(stage, { ...L.gateway, eyebrow: 'Hookdeck', title: 'Event Gateway', icon: 'hookdeck', variant: 'work', scale: L.k, status: L.status.gateway }),
    listen: node(stage, { ...L.listen, eyebrow: 'Hookdeck CLI', title: 'hookdeck listen', icon: 'terminal', scale: L.k, status: L.status.listen }),
    app: node(stage, { ...L.app, eyebrow: 'Localhost', title: build.options.flags?.tutorial ? 'Your app' : 'Demo app', icon: 'dns', scale: L.k, status: L.status.app }),
  }
  const ends = L.dir === 'h'
    ? { from: ['right', 'right', 'right'], to: ['left', 'left', 'left'] } as const
    : { from: ['bottom', 'bottom', 'bottom'], to: ['top', 'top', 'top'] } as const
  const edges: Record<EdgeId, Connector> = {
    in: connector(stage, nodes.agent[ends.from[0]], nodes.gateway[ends.to[0]], L.dir),
    out: connector(stage, nodes.gateway[ends.from[1]], nodes.listen[ends.to[1]], L.dir),
    local: connector(stage, nodes.listen[ends.from[2]], nodes.app[ends.to[2]], L.dir),
  }
  const edgeLabels: Record<EdgeId, SVGGElement> = {
    in: connectorLabel(stage, { ...L.edgeLabels.in, label: 'POST' }),
    out: connectorLabel(stage, { ...L.edgeLabels.out, label: 'WSS' }),
    local: connectorLabel(stage, { ...L.edgeLabels.local, label: 'HTTP' }),
  }
  const chips = chipRow(stage.overlay, { ...L.chips, items: [...CAPABILITIES], size: L.dir === 'h' ? 20 : 17, gap: L.dir === 'h' ? 14 : 8 })
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
  const order: NodeId[] = ['agent', 'gateway', 'listen', 'app']
  order.forEach((id, i) => show(tl, parts.nodes[id].g, 0.15 + i * 0.18))
  ;(['in', 'out', 'local'] as const).forEach((id, i) => {
    draw(tl, parts.edges[id].path, 0.55 + i * 0.18, 0.5)
    show(tl, parts.edgeLabels[id], 0.95 + i * 0.18)
  })
  return Math.max(show(tl, Object.values(parts.chips).map(c => c.g), 1.0), 1.5)
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
  const size = layout.dir === 'h' ? 21 : 18
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

const TRANSCRIPT = `transcript ${facts.transcriptSize}`
const AUDIO = `audio ${facts.audioSize}`

// ---- The scenarios ----

const scenarios: Record<ScenarioId, (b: SceneBuild, c: Ctx) => void> = {
  'delivery': (b, c) => {
    const { tl } = c
    b.intro(() => introAnimation(tl, c.parts))
    b.step((at) => {
      c.caption.to(tl, 1, at)
      const t = send(c, 'in', at, { label: TRANSCRIPT })
      return c.status.agent.set(t - 0.1, 'sent', 'blue')
    })
    b.step((at) => {
      c.caption.to(tl, 2, at)
      let t = work(c, ['verify', 'store'], 'success', at + 0.1)
      c.status.gateway.set(t - 0.3, 'verified · stored', 'success')
      return c.status.agent.set(t, 'got 200', 'success')
    })
    b.step((at) => {
      c.caption.to(tl, 3, at)
      let t = send(c, 'out', at, { label: TRANSCRIPT })
      c.status.listen.set(t - 0.2, 'forwarding', 'blue')
      t = send(c, 'local', t, { label: TRANSCRIPT })
      accepted(tl, c.parts.nodes.app, t - 0.15)
      c.status.listen.set(t, 'connected')
      return c.status.app.set(t, 'handled · attempt 1', 'success')
    })
    b.step((at) => {
      c.caption.to(tl, 4, at)
      resetChips(c, at)
      let t = send(c, 'in', at + 0.2, { label: AUDIO, big: true })
      c.status.agent.set(t, 'sent', 'blue')
      t = work(c, ['verify', 'store'], 'success', t)
      c.status.gateway.set(t - 0.3, 'verified · stored', 'success')
      c.status.agent.set(t, 'got 200', 'success')
      t = send(c, 'out', t, { label: AUDIO, big: true })
      c.status.listen.set(t - 0.2, 'forwarding', 'blue')
      t = send(c, 'local', t, { label: AUDIO, big: true })
      c.status.listen.set(t, 'connected')
      return c.status.app.set(t, 'handled · 2 events', 'success')
    })
  },

  'duplicate': (b, c) => {
    const { tl } = c
    let again: ReturnType<typeof packet>
    b.intro(() => {
      const t = introAnimation(tl, c.parts)
      accepted(tl, c.parts.nodes.app, t - 0.2)
      c.status.app.set(t - 0.1, 'handled · attempt 1', 'success')
      return c.status.gateway.set(t, 'verified · stored', 'success')
    })
    b.step((at) => {
      c.caption.to(tl, 1, at)
      // The repeat stops at Event Gateway's edge and stays there until step 2.
      again = packet(c.stage, c.parts.edges.in, { label: TRANSCRIPT })
      const t = travel(tl, again, at, 'arrive', 1.2)
      return c.status.agent.set(t - 0.1, 'sent again', 'blue')
    })
    b.step((at) => {
      c.caption.to(tl, 2, at)
      dropAt(tl, again, at + 0.3)
      const t = work(c, ['dedup'], 'warn', at + 0.1)
      c.status.gateway.set(t - 0.3, 'duplicate · dropped', 'warn')
      return c.status.agent.set(t, 'got 200', 'success')
    })
    b.step((at) => {
      c.caption.to(tl, 3, at)
      return c.status.listen.set(at + 0.2, 'nothing to forward', 'neutral')
    })
  },

  'bad-signature': (b, c) => {
    const { tl } = c
    let forged: ReturnType<typeof packet>
    b.intro(() => introAnimation(tl, c.parts))
    b.step((at) => {
      c.caption.to(tl, 1, at)
      forged = packet(c.stage, c.parts.edges.in, { label: 'bad signature' })
      const t = travel(tl, forged, at, 'arrive', 1.2)
      return c.status.agent.set(t - 0.1, 'sent', 'blue')
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
      c.status.agent.set(at + 0.1, 'got 200', 'success')
      return c.status.app.set(at + 0.2, 'never called', 'neutral')
    })
  },

  'app-down': (b, c) => {
    const { tl } = c
    b.intro(() => {
      const t = introAnimation(tl, c.parts)
      down(tl, c.parts.nodes.app, t - 0.2)
      return c.status.app.set(t, 'answering 500', 'danger')
    })
    b.step((at) => {
      c.caption.to(tl, 1, at)
      let t = send(c, 'in', at, { label: TRANSCRIPT })
      c.status.agent.set(t - 0.1, 'sent', 'blue')
      t = work(c, ['verify', 'store'], 'success', t)
      c.status.gateway.set(t - 0.3, 'verified · stored', 'success')
      return c.status.agent.set(t, 'got 200', 'success')
    })
    b.step((at) => {
      c.caption.to(tl, 2, at)
      let t = send(c, 'out', at, { label: TRANSCRIPT })
      c.status.listen.set(t - 0.2, 'forwarding', 'blue')
      const attempt = packet(c.stage, c.parts.edges.local, { label: TRANSCRIPT })
      t = travel(tl, attempt, t, 'arrive', 1.2)
      bounce(tl, attempt, t)
      c.status.app.set(t, 'attempt 1 · 500', 'danger')
      return c.status.gateway.set(t + 0.3, 'attempt 1 failed', 'danger')
    })
    b.step((at) => {
      c.caption.to(tl, 3, at)
      const t = work(c, ['retry'], 'warn', at + 0.1)
      return c.status.gateway.set(t, `retry in ${facts.retryIntervalSeconds} s`, 'warn')
    })
    b.step((at) => {
      c.caption.to(tl, 4, at)
      up(tl, c.parts.nodes.app, at)
      c.status.app.set(at, 'recovered', 'success')
      let t = send(c, 'out', at + 0.5, { label: TRANSCRIPT })
      c.status.listen.set(t, 'connected')
      t = send(c, 'local', t, { label: TRANSCRIPT })
      accepted(tl, c.parts.nodes.app, t - 0.15)
      toneTo(tl, c.parts.chips.retry, 'success', t)
      c.status.gateway.set(t, 'delivered · attempt 2', 'success')
      return c.status.app.set(t, 'handled · attempt 2', 'success')
    })
  },
}

// ---- The deployed view: provider -> Event Gateway -> your app, no `hookdeck listen` ----

interface DeployedLayout {
  canvas: Canvas
  dir: 'h' | 'v'
  k: number
  agent: { x: number, y: number, w: number, h: number }
  gateway: { x: number, y: number, w: number, h: number }
  app: { x: number, y: number, w: number, h: number }
  status: { agent: Point, gateway: Point, app: Point }
  chips: Point
  edgeLabels: { in: Point, out: Point }
  caption: { x: number, y: number, max: number, size: number }
  crop: string
}

const DEPLOYED_DESKTOP: DeployedLayout = {
  canvas: { width: 1920, height: 1080 },
  dir: 'h',
  k: 1,
  agent: { x: 250, y: 470, w: 300, h: 150 },
  gateway: { x: 960, y: 470, w: 390, h: 210 },
  app: { x: 1670, y: 470, w: 300, h: 150 },
  status: { agent: { x: 0, y: 118 }, gateway: { x: 0, y: -150 }, app: { x: 0, y: 118 } },
  chips: { x: 960, y: 624 },
  edgeLabels: { in: { x: 605, y: 512 }, out: { x: 1315, y: 512 } },
  caption: { x: 60, y: 870, max: 78, size: 38 },
  crop: '30 270 1860 420',
}

const DEPLOYED_PHONE: DeployedLayout = {
  canvas: { width: 640, height: 880 },
  dir: 'v',
  k: 0.9,
  agent: { x: 320, y: 90, w: 440, h: 120 },
  gateway: { x: 320, y: 410, w: 500, h: 170 },
  app: { x: 320, y: 745, w: 440, h: 120 },
  status: { agent: { x: 0, y: 100 }, gateway: { x: 0, y: 180 }, app: { x: 0, y: 85 } },
  chips: { x: 320, y: 540 },
  edgeLabels: { in: { x: 320, y: 262 }, out: { x: 320, y: 650 } },
  caption: { x: 0, y: 0, max: 0, size: 0 },
  crop: '0 0 640 880',
}

function deployedScene(layout: DeployedLayout, name: string) {
  return defineScene(name, (b) => {
    const { stage, tl } = b
    const L = layout
    const nodes = {
      agent: node(stage, { ...L.agent, eyebrow: 'ElevenLabs', title: 'Voice agent', icon: 'mic', scale: L.k, status: L.status.agent }),
      gateway: node(stage, { ...L.gateway, eyebrow: 'Hookdeck', title: 'Event Gateway', icon: 'hookdeck', variant: 'work', scale: L.k, status: L.status.gateway }),
      app: node(stage, { ...L.app, eyebrow: 'Deployed', title: 'Your app', icon: 'dns', scale: L.k, status: L.status.app }),
    }
    const ends = L.dir === 'h' ? { from: 'right', to: 'left' } as const : { from: 'bottom', to: 'top' } as const
    const edges = {
      in: connector(stage, nodes.agent[ends.from], nodes.gateway[ends.to], L.dir),
      out: connector(stage, nodes.gateway[ends.from], nodes.app[ends.to], L.dir),
    }
    const edgeLabels = [
      connectorLabel(stage, { ...L.edgeLabels.in, label: 'POST' }),
      connectorLabel(stage, { ...L.edgeLabels.out, label: 'HTTPS' }),
    ]
    const chips = chipRow(stage.overlay, { ...L.chips, items: [...CAPABILITIES], size: L.dir === 'h' ? 20 : 17, gap: L.dir === 'h' ? 14 : 8 })

    for (const n of Object.values(nodes))
      gsap.set(n.g, { autoAlpha: 0 })
    for (const e of Object.values(edges))
      drawable(e.path)
    for (const l of edgeLabels)
      gsap.set(l, { autoAlpha: 0 })
    for (const c of Object.values(chips))
      gsap.set(c.g, { autoAlpha: 0 })

    const size = L.dir === 'h' ? 21 : 18
    const status = {} as Record<keyof typeof nodes, { set: (at: number, label: string, tone?: Tone) => number }>
    for (const key of Object.keys(nodes) as (keyof typeof nodes)[]) {
      let current: SVGGElement | null = null
      status[key] = {
        set(at, label, tone = 'neutral') {
          const chip = statusChip(stage, nodes[key], label, tone, size)
          const t = swap(tl, current, chip, at)
          current = chip
          return t
        },
      }
    }
    const caption = captions(stage, [...deployedCaptionsBy], { x: L.caption.x, y: L.caption.y }, b.options.captions && L.dir === 'h', { max: L.caption.max, size: L.caption.size })
    const send = (edge: keyof typeof edges, at: number, label: string, big = false) =>
      travel(tl, packet(stage, edges[edge], { big, label }), at, 'into', big ? 1.9 : 1.2)
    const work = (ids: string[], at: number) => {
      let t = at
      for (const id of ids) {
        toneTo(tl, chips[id], 'success', t)
        pulse(tl, chips[id].g, t)
        t += 0.4
      }
      return t
    }

    b.intro(() => {
      ;(['agent', 'gateway', 'app'] as const).forEach((id, i) => show(tl, nodes[id].g, 0.15 + i * 0.18))
      ;(['in', 'out'] as const).forEach((id, i) => {
        draw(tl, edges[id].path, 0.55 + i * 0.18, 0.5)
        show(tl, edgeLabels[i], 0.95 + i * 0.18)
      })
      return Math.max(show(tl, Object.values(chips).map(c => c.g), 1.0), 1.5)
    })
    b.step((at) => {
      caption.to(tl, 1, at)
      const t = send('in', at, TRANSCRIPT)
      return status.agent.set(t - 0.1, 'sent', 'blue')
    })
    b.step((at) => {
      caption.to(tl, 2, at)
      const t = work(['verify', 'store'], at + 0.1)
      status.gateway.set(t - 0.3, 'verified · stored', 'success')
      return status.agent.set(t, 'got 200', 'success')
    })
    b.step((at) => {
      caption.to(tl, 3, at)
      const t = send('out', at, TRANSCRIPT)
      accepted(tl, nodes.app, t - 0.15)
      return status.app.set(t, 'verified · stored', 'success')
    })
    b.step((at) => {
      caption.to(tl, 4, at)
      for (const chip of Object.values(chips))
        toneTo(tl, chip, 'neutral', at)
      let t = send('in', at + 0.2, AUDIO, true)
      status.agent.set(t, 'sent', 'blue')
      t = work(['verify', 'store'], t)
      status.gateway.set(t - 0.3, 'verified · stored', 'success')
      status.agent.set(t, 'got 200', 'success')
      t = send('out', t, AUDIO, true)
      return status.app.set(t, 'stored · 2 events', 'success')
    })
  }, { canvas: layout.canvas })
}

export const createDeployedScene = deployedScene(DEPLOYED_DESKTOP, 'deployed')
export const createDeployedMobileScene = deployedScene(DEPLOYED_PHONE, 'deployed-mobile')
export const deployedCaptions = deployedCaptionsBy
export const deployedCrop = DEPLOYED_DESKTOP.crop

// ---- Scene factories ----

function scripted(id: ScenarioId, layout: Layout, name: string) {
  return defineScene(name, (b) => {
    const parts = buildParts(b, layout)
    hideForIntro(parts)
    const c = makeCtx(b, parts, layout, id)
    scenarios[id](b, c)
  }, { canvas: layout.canvas })
}

export const createDeliveryScene = scripted('delivery', DESKTOP, 'delivery')
export const createDeliveryMobileScene = scripted('delivery', PHONE, 'delivery-mobile')
export const createDuplicateScene = scripted('duplicate', DESKTOP, 'duplicate')
export const createDuplicateMobileScene = scripted('duplicate', PHONE, 'duplicate-mobile')
export const createBadSignatureScene = scripted('bad-signature', DESKTOP, 'bad-signature')
export const createBadSignatureMobileScene = scripted('bad-signature', PHONE, 'bad-signature-mobile')
export const createAppDownScene = scripted('app-down', DESKTOP, 'app-down')
export const createAppDownMobileScene = scripted('app-down', PHONE, 'app-down-mobile')

// The captions arrays the website's sync reads (strings only).
export const deliveryCaptions = captionsBy.delivery
export const duplicateCaptions = captionsBy.duplicate
export const badSignatureCaptions = captionsBy['bad-signature']
export const appDownCaptions = captionsBy['app-down']

/** Per-scene crop of the desktop canvas (SVG viewBox), for a page that shows the diagram without the empty slide around it. */
export const desktopCrop = DESKTOP.crop

/**
 * The live scene: the same components, no steps. Everything is on stage from the start, and
 * `scene.live` (a LiveDriver) launches packets and sets badges as the page's feed reports events.
 * Node ids: agent, gateway, listen, app. Edge ids: in, out, local. Chip ids: verify, store, dedup, retry.
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

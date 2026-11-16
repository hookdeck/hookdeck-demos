import { gsap } from 'gsap'
import { accepted, bounce, down, dropAt, packet, pulse, travel, up } from './anim'
import { statusChip, type Tone, type ToneChip, toneTo } from './parts'
import type { Connector, Node, Stage } from './stage'
import { dur } from './tokens'

// The live driver: the same scene, run by real events instead of its scripted timeline. A scene
// file registers one with `live(createLive(...))` from the components it built; a host (the demo
// page) then calls `send`, `badge`, `state` and `chip` as events arrive. It reuses the scripted
// primitives (`travel`, `bounce`, `down`, `accepted`) on a timeline it plays in real time, so a
// live packet looks exactly like a scripted one.
//
// Packets on one edge queue: a second `send` waits until the first has arrived and faded, so two
// webhooks a second apart never overlap. A 3.5 MB payload travels slower and thicker, with its
// size label, so it reads as heavy.

export interface LiveTopology {
  stage: Stage
  nodes: Record<string, Node>
  edges: Record<string, Connector>
  chips: Record<string, ToneChip>
}

export interface SendOptions {
  /** Size or type label that rides with the packet. */
  label?: string
  /** A heavy payload: thicker, slower. */
  big?: boolean
  /**
   * What happens at the far end. `into` (default): delivered, the packet slides under the node.
   * `bounce`: the node refused it, so the packet turns red and fades. `drop`: stopped there, as a
   * duplicate or a rejected request is (red when `failed`).
   */
  end?: 'into' | 'bounce' | 'drop'
  failed?: boolean
  /** Seconds the packet takes. Defaults to 1.1, or 2.4 for a big one. */
  duration?: number
  /** What the packet stands for, for click-through. */
  data?: unknown
}

export type Selection =
  | { kind: 'node', id: string }
  | { kind: 'packet', edge: string, data: unknown }

export interface LiveDriver {
  /** Sends a packet along an edge. Resolves when it arrives; the edge stays busy until it has faded. */
  send: (edge: string, o?: SendOptions) => Promise<void>
  /** Shows a status chip under a node (null clears it). `ttl` seconds later it fades by itself. */
  badge: (node: string, label: string | null, tone?: Tone, ttl?: number) => void
  /** Sets a node's state ring and badge: `down` (red, "!"), `ok` (green, check), or null for normal. */
  state: (node: string, state: 'down' | 'ok' | null, ttl?: number) => void
  /** Pulses a capability chip and sets its tone; `hold` seconds later it returns to neutral (omit to leave it). */
  chip: (id: string, tone: Tone, hold?: number) => void
  /** Called when a node or a travelling packet is clicked. */
  onSelect: (handler: (selection: Selection) => void) => void
  /** Clears badges, rings and any packets in flight. */
  reset: () => void
  destroy: () => void
}

export function createLive(topology: LiveTopology): LiveDriver {
  const { stage, nodes, edges, chips } = topology
  const queues = new Map<string, Promise<unknown>>()
  const badges = new Map<string, SVGGElement>()
  const timers = new Set<gsap.core.Tween>()
  const inflight = new Set<{ destroy: () => void, tl: gsap.core.Timeline }>()
  let handler: ((selection: Selection) => void) | undefined
  let destroyed = false

  for (const [id, n] of Object.entries(nodes)) {
    n.g.style.cursor = 'pointer'
    n.g.addEventListener('click', () => handler?.({ kind: 'node', id }))
  }

  const later = (seconds: number, fn: () => void) => {
    const t = gsap.delayedCall(seconds, () => {
      timers.delete(t)
      fn()
    })
    timers.add(t)
  }

  function send(edge: string, o: SendOptions = {}): Promise<void> {
    const conn = edges[edge]
    if (!conn)
      throw new Error(`Live driver: no edge "${edge}"`)
    const big = o.big ?? false
    const duration = o.duration ?? (big ? 2.4 : 1.1)
    const end = o.end ?? 'into'

    let arrive!: () => void
    const arrived = new Promise<void>(resolve => (arrive = resolve))
    const run = () => new Promise<void>((done) => {
      if (destroyed)
        return done(arrive())
      const p = packet(stage, conn, { big, label: o.label })
      const tl = gsap.timeline({ onComplete: finish })
      const entry = { destroy: () => p.destroy(), tl }
      inflight.add(entry)
      function finish() {
        inflight.delete(entry)
        p.destroy()
        done()
      }
      p.g.style.cursor = 'pointer'
      p.g.addEventListener('click', () => handler?.({ kind: 'packet', edge, data: o.data }))
      const t = travel(tl, p, 0, end === 'into' ? 'into' : 'arrive', duration)
      tl.call(arrive, [], t)
      if (end === 'bounce')
        bounce(tl, p, t)
      else if (end === 'drop')
        dropAt(tl, p, t, o.failed)
      else
        tl.to({}, { duration: 0.05 }, t)
    })
    const next = (queues.get(edge) ?? Promise.resolve()).then(run)
    queues.set(edge, next)
    return arrived
  }

  function badge(node: string, label: string | null, tone: Tone = 'neutral', ttl?: number) {
    const n = nodes[node]
    if (!n)
      throw new Error(`Live driver: no node "${node}"`)
    const old = badges.get(node)
    if (old) {
      gsap.to(old, { autoAlpha: 0, duration: dur.ui * 0.6, onComplete: () => old.remove() })
      badges.delete(node)
    }
    if (label === null)
      return
    const g = statusChip(stage, n, label, tone)
    badges.set(node, g)
    gsap.to(g, { autoAlpha: 1, duration: dur.ui })
    if (ttl !== undefined) {
      later(ttl, () => {
        if (badges.get(node) === g)
          badge(node, null)
      })
    }
  }

  function state(node: string, s: 'down' | 'ok' | null, ttl?: number) {
    const n = nodes[node]
    const tl = gsap.timeline()
    if (s === 'down')
      down(tl, n, 0)
    else if (s === 'ok')
      accepted(tl, n, 0)
    else
      up(tl, n, 0)
    if (s && ttl !== undefined)
      later(ttl, () => state(node, null))
  }

  function chip(id: string, tone: Tone, hold?: number) {
    const c = chips[id]
    if (!c)
      throw new Error(`Live driver: no chip "${id}"`)
    const tl = gsap.timeline()
    toneTo(tl, c, tone, 0)
    pulse(tl, c.g, 0)
    if (hold !== undefined)
      later(hold, () => toneTo(gsap.timeline(), c, 'neutral', 0))
  }

  function reset() {
    queues.clear()
    for (const t of timers)
      t.kill()
    timers.clear()
    for (const e of inflight) {
      e.tl.kill()
      e.destroy()
    }
    inflight.clear()
    for (const node of Object.keys(nodes)) {
      badge(node, null)
      state(node, null)
    }
    for (const c of Object.values(chips))
      toneTo(gsap.timeline(), c, 'neutral', 0)
  }

  return {
    send,
    badge,
    state,
    chip,
    onSelect(h) {
      handler = h
    },
    reset,
    destroy() {
      destroyed = true
      reset()
    },
  }
}

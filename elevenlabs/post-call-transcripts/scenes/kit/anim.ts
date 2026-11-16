// Generated from `_shared/scenes/anim.ts`; edit there and run `npm run sync-shared`.
import { gsap } from 'gsap'
import type { Connector, Node, Point, Stage } from './stage'
import { el, text } from './svg'
import { color, dur, EASE_UI } from './tokens'

// Animation primitives. Each one adds tweens to a timeline at a given time and returns the time
// it finishes, so a scene reads as a sequence of cause and effect. Everything is a .to() tween
// from a state set at build time, so seeking to any step, forwards or backwards, renders the same
// frame, which the capture script and the website's Back button depend on. The live driver
// (live.ts) calls the same primitives on a timeline it plays in real time.

type Timeline = gsap.core.Timeline

// ---- Events travelling along connectors ----

export interface PacketOptions {
  /** A heavy payload (megabytes): a thicker, longer packet that travels slower. */
  big?: boolean
  /** A size or type label that travels with the packet and slides under the nodes at each end. */
  label?: string
}

/** One event on one connector: a blue head with a lighter tail, like the illustrations' dashes. */
export interface Packet {
  g: SVGGElement
  /** The blue packet and the red one a failed attempt turns into: layers, because GSAP can't tween `var(...)` colors. */
  blue: SVGGElement
  red: SVGGElement
  paths: SVGPathElement[]
  conn: Connector
  big: boolean
  head: number
  tail: number
  width: number
  label?: { g: SVGGElement, width: number, at: (p: Point) => void }
  destroy: () => void
}

export function packet(stage: Stage, conn: Connector, o: PacketOptions = {}): Packet {
  const big = o.big ?? false
  const width = big ? 14 : 7
  const head = big ? 96 : 56
  const tail = big ? 230 : 150
  const g = el('g', {}, stage.packets)
  const gap = conn.length + head + tail + 20
  const paths: SVGPathElement[] = []
  const layer = (stroke: [string, string]) => {
    const group = el('g', {}, g)
    ;[[tail, stroke[1]], [head, stroke[0]]].forEach(([length, color_]) => {
      const path = el('path', { d: conn.d, 'fill': 'none', 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-dasharray': `${length} ${gap}` }, group)
      path.style.stroke = String(color_)
      // Offset by the dash length (plus the round cap) so the dash starts just before the path.
      gsap.set(path, { strokeDashoffset: Number(length) + width })
      paths.push(path)
    })
    return group
  }
  const blue = layer([color.blue, color.blueSoft])
  const red = layer([color.danger, color.dangerOutline])
  gsap.set(red, { autoAlpha: 0 })
  gsap.set(g, { autoAlpha: 0 })

  let label: Packet['label']
  if (o.label) {
    const size = 20
    const w = o.label.length * size * 0.64 + 28
    // A label wider than its connector can't fit between two nodes, so it draws above them
    // (the overlay layer) instead of sliding under them.
    const lg = el('g', {}, conn.dir === 'h' && w + 16 > conn.length ? stage.overlay : stage.labels)
    const rect = el('rect', { x: -w / 2, y: -17, width: w, height: 34, rx: 17, 'stroke-width': 1.5 }, lg)
    rect.style.fill = big ? color.blue : color.blueBadgeBg
    rect.style.stroke = big ? color.blue : color.blueBadgeOutline
    const t = text(lg, o.label.toUpperCase(), { x: 0, y: 1, class: 'mono', 'font-size': size, 'letter-spacing': '0.04em', 'text-anchor': 'middle', 'dominant-baseline': 'central' })
    t.style.fill = big ? color.white : color.blue
    gsap.set(lg, { autoAlpha: 0 })
    label = {
      g: lg,
      width: w,
      at: (pt) => {
        // Above a left-to-right connector, to the right of a top-to-bottom one.
        const pos = conn.dir === 'h' ? { x: pt.x, y: pt.y - 46 } : { x: pt.x + w / 2 + 22, y: pt.y }
        lg.setAttribute('transform', `translate(${pos.x} ${pos.y})`)
      },
    }
  }
  return { g, blue, red, paths, conn, big, head, tail, width, label, destroy: () => { g.remove(); label?.g.remove() } }
}

/**
 * Moves a packet along its connector.
 * - `into`: the packet slides under the target node and disappears (delivered).
 * - `arrive`: the head stops at the target's edge (use `bounce` next for a failed attempt).
 */
export function travel(tl: Timeline, p: Packet, at: number, mode: 'into' | 'arrive', duration: number = p.big ? dur.travelBig : dur.travel): number {
  const distance = mode === 'into' ? p.conn.length + p.tail + p.width * 2 : p.conn.length
  tl.set(p.g, { autoAlpha: 1 }, at)
  const [tailPath, headPath, redTail, redHead] = p.paths
  tl.to([headPath, redHead], { strokeDashoffset: p.head + p.width - distance, duration, ease: 'sine.inOut' }, at)
  tl.to([tailPath, redTail], { strokeDashoffset: p.tail + p.width - distance, duration, ease: 'sine.inOut' }, at)
  if (p.label) {
    const { label } = p
    const proxy = { p: 0 }
    const place = () => {
      let front = Math.max(0, Math.min(p.conn.length, -p.width + (distance + p.width) * proxy.p))
      // A packet that stops at a node keeps its label whole on the connector: centered on the
      // head, half of it would sit under the node card.
      if (mode === 'arrive' && p.conn.dir === 'h')
        front = Math.min(front, Math.max(p.conn.length / 2, p.conn.length - label.width / 2 - 8))
      label.at(p.conn.path.getPointAtLength(front))
    }
    place()
    tl.set(label.g, { autoAlpha: 1 }, at)
    tl.fromTo(proxy, { p: 0 }, { p: 1, duration, ease: 'sine.inOut', onUpdate: place }, at)
    if (mode === 'into')
      tl.to(label.g, { autoAlpha: 0, duration: 0.25 }, at + duration - 0.35)
  }
  if (mode === 'into')
    tl.set(p.g, { autoAlpha: 0 }, at + duration)
  return at + duration
}

/** A failed attempt: the packet turns red where it stopped, then fades. */
export function bounce(tl: Timeline, p: Packet, at: number): number {
  tl.to(p.blue, { autoAlpha: 0, duration: 0.25 }, at)
  tl.to(p.red, { autoAlpha: 1, duration: 0.25 }, at)
  tl.to(p.g, { autoAlpha: 0, duration: dur.ui }, at + dur.beat)
  if (p.label)
    tl.to(p.label.g, { autoAlpha: 0, duration: dur.ui }, at + dur.beat)
  return at + dur.beat + dur.ui
}

/** The packet stops at a node and fades: dropped there (a duplicate, a rejected request). Red when `failed`. */
export function dropAt(tl: Timeline, p: Packet, at: number, failed = false): number {
  if (failed) {
    tl.to(p.blue, { autoAlpha: 0, duration: 0.25 }, at)
    tl.to(p.red, { autoAlpha: 1, duration: 0.25 }, at)
  }
  tl.to(p.g, { autoAlpha: 0, duration: dur.ui }, at + dur.beat)
  if (p.label)
    tl.to(p.label.g, { autoAlpha: 0, duration: dur.ui }, at + dur.beat)
  return at + dur.beat + dur.ui
}

// ---- Component state ----

/** The component stops answering: red ring, "!" badge. */
export function down(tl: Timeline, n: Node, at: number): number {
  tl.to(n.ringOk, { autoAlpha: 0, duration: dur.ui * 0.6 }, at)
  tl.to(n.ringDanger, { autoAlpha: 1, duration: dur.ui, ease: EASE_UI }, at)
  tl.to(n.ok.g, { autoAlpha: 0, scale: 0.6, duration: dur.ui * 0.6 }, at)
  tl.to(n.alert.g, { autoAlpha: 1, scale: 1, duration: dur.ui, ease: 'back.out(2)' }, at)
  return at + dur.ui
}

/** The component is back to normal. */
export function up(tl: Timeline, n: Node, at: number): number {
  tl.to([n.ringDanger, n.ringOk], { autoAlpha: 0, duration: dur.ui, ease: EASE_UI }, at)
  tl.to([n.alert.g, n.ok.g], { autoAlpha: 0, scale: 0.6, duration: dur.ui * 0.6 }, at)
  return at + dur.ui
}

/** The component accepted the event: green ring, check badge. */
export function accepted(tl: Timeline, n: Node, at: number): number {
  tl.to(n.ringDanger, { autoAlpha: 0, duration: dur.ui * 0.6 }, at)
  tl.to(n.ringOk, { autoAlpha: 1, duration: dur.ui, ease: EASE_UI }, at)
  tl.to(n.alert.g, { autoAlpha: 0, scale: 0.6, duration: dur.ui * 0.6 }, at)
  tl.to(n.ok.g, { autoAlpha: 1, scale: 1, duration: dur.ui, ease: 'back.out(2)' }, at)
  return at + dur.ui
}

/** A short pulse on an element, such as a capability chip doing its work. */
export function pulse(tl: Timeline, target: Element | Element[], at: number): number {
  tl.to(target, { scale: 1.12, duration: 0.18, ease: 'sine.out', transformOrigin: '50% 50%' }, at)
  tl.to(target, { scale: 1, duration: 0.3, ease: 'sine.inOut' }, at + 0.18)
  return at + 0.48
}

// ---- Text and drawn lines ----

/** A text element that starts hidden, for `show`, `hide` and `swap`. */
export function hiddenText(parent: Element, content: string, attrs: Record<string, string | number>, fill: string): SVGTextElement {
  const t = text(parent, content, attrs)
  t.style.fill = fill
  gsap.set(t, { autoAlpha: 0 })
  return t
}

export function show(tl: Timeline, target: Element | Element[], at: number, duration: number = dur.ui): number {
  tl.to(target, { autoAlpha: 1, duration, ease: EASE_UI }, at)
  return at + duration
}

export function hide(tl: Timeline, target: Element | Element[], at: number, duration: number = dur.ui * 0.6): number {
  tl.to(target, { autoAlpha: 0, duration }, at)
  return at + duration
}

/** Crossfades one element out and another in, such as a status chip changing. */
export function swap(tl: Timeline, from: Element | null, to: Element, at: number): number {
  if (from)
    hide(tl, from, at)
  return show(tl, to, at + (from ? dur.ui * 0.3 : 0))
}

/** Prepares a path to be drawn on by `draw`. */
export function drawable(path: SVGPathElement): SVGPathElement {
  const length = path.getTotalLength()
  path.style.strokeDasharray = `${length} ${length + 2}`
  // Hidden as well as offset, or a round line cap shows as a dot before the line is drawn.
  gsap.set(path, { strokeDashoffset: length, autoAlpha: 0 })
  return path
}

export function draw(tl: Timeline, path: SVGPathElement, at: number, duration: number = 0.8): number {
  tl.set(path, { autoAlpha: 1 }, at)
  tl.to(path, { strokeDashoffset: 0, duration, ease: EASE_UI }, at)
  return at + duration
}

// ---- Captions for silent loops ----

/** Splits a caption into lines of at most `max` characters, at spaces. */
export function wrap(line: string, max: number): string[] {
  const out: string[] = []
  let current = ''
  for (const word of line.split(' ')) {
    if (current && (current + ' ' + word).length > max) {
      out.push(current)
      current = word
    }
    else {
      current = current ? `${current} ${word}` : word
    }
  }
  if (current)
    out.push(current)
  return out
}

export interface CaptionOptions {
  /** Characters per line before wrapping. Default 84. */
  max?: number
  /** Font size in canvas units. Default 34. */
  size?: number
}

/**
 * One caption per step, drawn in the SVG, for a silent loop. Step 0's caption shows from the
 * start. `enabled` false draws nothing (the website shows `scene.captions` as HTML under the
 * diagram, and the deck's presenter narrates). The strings are recorded either way in
 * `stage.captionLines`. A caption may mark a term in backticks; the SVG drops the backticks.
 */
export function captions(stage: Stage, lines: string[], at: Point, enabled: boolean, o: CaptionOptions = {}) {
  stage.captionLines = lines
  const size = o.size ?? 34
  const items = lines.map((line, i) => {
    if (!enabled)
      return null
    const g = el('g', { transform: `translate(${at.x} ${at.y})` }, stage.overlay)
    const plain = line.replace(/`/g, '')
    // Step 0 sets the scene, so it has no number.
    const indent = i > 0 ? size * 2.6 : 0
    if (i > 0)
      text(g, `${i}/${lines.length - 1}`, { x: 0, y: 0, class: 'caption-step', 'font-size': size * 0.7 })
    wrap(plain, o.max ?? 84).forEach((part, row) => text(g, part, { x: indent, y: row * size * 1.4, class: 'caption', 'font-size': size }))
    gsap.set(g, { autoAlpha: i === 0 ? 1 : 0 })
    return g
  })
  return {
    /** Swaps to step `i`'s caption. */
    to(tl: Timeline, i: number, time: number) {
      const [from, to] = [items[i - 1], items[i]]
      if (!enabled || !from || !to)
        return
      hide(tl, from, time)
      show(tl, to, time + 0.15)
    },
  }
}

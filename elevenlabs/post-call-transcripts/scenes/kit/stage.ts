// Generated from `_shared/scenes/stage.ts`; edit there and run `npm run sync-shared`.
import { gsap } from 'gsap'
import { el, icon, type IconName, text } from './svg'
import { color } from './tokens'

// The stage draws components in the Hookdeck design system's diagram language: white cards with
// an icon tile, a mono eyebrow and a title; a blue-outlined card for the component doing the
// work; light connectors; mono caps chips. Layers, bottom to top: connectors, packets, labels
// (a packet's size label, which slides under the nodes), nodes, overlay.

export interface Canvas { width: number, height: number }

/** The slides' canvas. A portrait layout for a web page passes its own to `defineScene`. */
export const CANVAS: Canvas = { width: 1920, height: 1080 }

export interface Point { x: number, y: number }

type DefName = 'shadow' | 'glow-blue' | 'glow-danger' | 'glow-success' | 'card-fill'

export interface Stage {
  svg: SVGSVGElement
  connectors: SVGGElement
  packets: SVGGElement
  labels: SVGGElement
  nodes: SVGGElement
  overlay: SVGGElement
  /** A `url(#…)` reference to one of this stage's filters or gradients. Ids are unique per stage, because a page can render one scene twice. */
  ref: (name: DefName) => string
  /** The step captions, as `captions()` recorded them, for a host that shows them outside the SVG (a web page). */
  captionLines: string[]
  destroy: () => void
}

let stageCount = 0

export function createStage(host: HTMLElement, canvas: Canvas = CANVAS): Stage {
  const uid = `s${++stageCount}`
  const svg = el('svg', { viewBox: `0 0 ${canvas.width} ${canvas.height}`, class: 'stage' })
  host.appendChild(svg)

  const defs = el('defs', {}, svg)
  const shadow = el('filter', { id: `${uid}-shadow`, x: '-20%', y: '-50%', width: '140%', height: '200%' }, defs)
  for (const [dy, blur, opacity] of [[1.5, 1.5, 0.08], [6, 9, 0.07]] as const) {
    const drop = el('feDropShadow', { dx: 0, dy, stdDeviation: blur, 'flood-opacity': opacity }, shadow)
    drop.style.floodColor = '#000'
  }
  for (const [name, flood, opacity] of [['glow-blue', color.blue, 0.2], ['glow-danger', color.danger, 0.3], ['glow-success', color.success, 0.28]] as const) {
    const glow = el('filter', { id: `${uid}-${name}`, x: '-30%', y: '-60%', width: '160%', height: '220%' }, defs)
    const drop = el('feDropShadow', { dx: 0, dy: 8, stdDeviation: 14, 'flood-opacity': opacity }, glow)
    drop.style.floodColor = flood
  }
  const cardFill = el('linearGradient', { id: `${uid}-card-fill`, x1: 0, y1: 0, x2: 0, y2: 1 }, defs)
  const top = el('stop', { offset: 0 }, cardFill)
  top.style.stopColor = color.white
  const bottom = el('stop', { offset: 1 }, cardFill)
  bottom.style.stopColor = color.blueBadgeBg

  return {
    svg,
    connectors: el('g', { class: 'connectors' }, svg),
    packets: el('g', { class: 'packets' }, svg),
    labels: el('g', { class: 'labels' }, svg),
    nodes: el('g', { class: 'nodes' }, svg),
    overlay: el('g', { class: 'overlay' }, svg),
    ref: name => `url(#${uid}-${name})`,
    captionLines: [],
    destroy: () => svg.remove(),
  }
}

export interface Badge { g: SVGGElement }

function badge(stage: Stage, parent: SVGGElement, kind: 'alert' | 'ok', at: Point, r: number): Badge {
  const outer = el('g', { transform: `translate(${at.x} ${at.y})` }, parent)
  const g = el('g', {}, outer)
  const circle = el('circle', { r, 'stroke-width': 3, filter: stage.ref(kind === 'alert' ? 'glow-danger' : 'glow-success') }, g)
  circle.style.fill = color.white
  circle.style.stroke = kind === 'alert' ? color.dangerOutline : color.successOutline
  icon(g, kind === 'alert' ? 'priority_high' : 'check', -r * 0.65, -r * 0.65, r * 1.3, kind === 'alert' ? color.danger : color.success)
  gsap.set(g, { autoAlpha: 0, scale: 0.6, transformOrigin: '50% 50%' })
  return { g }
}

export interface NodeSpec {
  x: number
  y: number
  w: number
  h?: number
  /** Mono caps line above the title: what kind of component it is. */
  eyebrow: string
  title: string
  icon: IconName
  /** `work` is the blue-outlined card for the component doing the work (Event Gateway). */
  variant?: 'plain' | 'work'
  /** Where the "!" and check badges sit, relative to the node's center: its top-right corner by default. */
  badge?: Point
  /** Where the status chip sits, relative to the node's center: below it by default. */
  status?: Point
  /** Scale for text and icon, for a canvas smaller than the slides'. */
  scale?: number
}

export interface Node {
  g: SVGGElement
  x: number
  y: number
  w: number
  h: number
  left: Point
  right: Point
  top: Point
  bottom: Point
  /** Absolute position of the node's status chip. */
  statusAt: Point
  /** State rings around the card: red when the component fails, green when it accepts. */
  ringDanger: SVGRectElement
  ringOk: SVGRectElement
  alert: Badge
  ok: Badge
  eyebrow: SVGTextElement
  title: SVGTextElement
}

export function node(stage: Stage, o: NodeSpec): Node {
  const h = o.h ?? 150
  const k = o.scale ?? 1
  const g = el('g', { transform: `translate(${o.x} ${o.y})` }, stage.nodes)
  const pad = 10
  const rx = 22
  const ring = (stroke: string) => {
    const r = el('rect', { x: -o.w / 2 - pad, y: -h / 2 - pad, width: o.w + pad * 2, height: h + pad * 2, rx: rx + pad, fill: 'none', 'stroke-width': 8 }, g)
    r.style.stroke = stroke
    gsap.set(r, { autoAlpha: 0 })
    return r
  }
  const ringDanger = ring(color.dangerOutline)
  const ringOk = ring(color.successOutline)

  const work = o.variant === 'work'
  const body = el('rect', { x: -o.w / 2, y: -h / 2, width: o.w, height: h, rx, 'stroke-width': work ? 2.5 : 1.5, filter: stage.ref(work ? 'glow-blue' : 'shadow') }, g)
  body.style.fill = work ? stage.ref('card-fill') : color.white
  body.style.stroke = work ? color.blueSoft : color.outline2

  // Icon tile, at the card's left, centered vertically.
  const tile = 68 * k
  const tx = -o.w / 2 + 24 * k
  const tileBox = el('rect', { x: tx, y: -tile / 2, width: tile, height: tile, rx: 14 * k, 'stroke-width': 1.5 }, g)
  tileBox.style.fill = color.blueBadgeBg
  tileBox.style.stroke = color.blueBadgeOutline
  const glyph = tile * 0.55
  icon(g, o.icon, tx + (tile - glyph) / 2, -glyph / 2, glyph, color.blue)

  const textX = tx + tile + 20 * k
  const eyebrow = text(g, o.eyebrow.toUpperCase(), { x: textX, y: -8 * k, class: 'mono', 'font-size': 19 * k, 'letter-spacing': '0.08em' })
  eyebrow.style.fill = color.fg3
  const title = text(g, o.title, { x: textX, y: 30 * k, class: 'sans-title', 'font-size': 33 * k })
  title.style.fill = color.ink

  const alertAt = o.badge ?? { x: o.w / 2 - 8, y: -h / 2 + 8 }
  return {
    g,
    x: o.x,
    y: o.y,
    w: o.w,
    h,
    left: { x: o.x - o.w / 2, y: o.y },
    right: { x: o.x + o.w / 2, y: o.y },
    top: { x: o.x, y: o.y - h / 2 },
    bottom: { x: o.x, y: o.y + h / 2 },
    statusAt: { x: o.x + (o.status?.x ?? 0), y: o.y + (o.status?.y ?? h / 2 + 46 * k) },
    ringDanger,
    ringOk,
    alert: badge(stage, g, 'alert', alertAt, 26 * k),
    ok: badge(stage, g, 'ok', alertAt, 26 * k),
    eyebrow,
    title,
  }
}

export interface Connector { path: SVGPathElement, d: string, length: number, dir: 'h' | 'v' }

/**
 * A curved connector from `a` to `b`. `h` (default) leaves and arrives horizontally, for a
 * left-to-right layout; `v` leaves and arrives vertically, for a portrait layout.
 */
export function connector(stage: Stage, a: Point, b: Point, dir: 'h' | 'v' = 'h'): Connector {
  const d = dir === 'h'
    ? `M ${a.x} ${a.y} C ${a.x + (b.x - a.x) / 2} ${a.y}, ${b.x - (b.x - a.x) / 2} ${b.y}, ${b.x} ${b.y}`
    : `M ${a.x} ${a.y} C ${a.x} ${a.y + (b.y - a.y) / 2}, ${b.x} ${b.y - (b.y - a.y) / 2}, ${b.x} ${b.y}`
  const path = el('path', { d, fill: 'none', 'stroke-width': 6, 'stroke-linecap': 'round' }, stage.connectors)
  path.style.stroke = color.connector
  return { path, d, length: path.getTotalLength(), dir }
}

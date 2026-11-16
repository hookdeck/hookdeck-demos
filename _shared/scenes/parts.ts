import { gsap } from 'gsap'
import type { Node, Point, Stage } from './stage'
import { el, icon, type IconName, text } from './svg'
import { color, dur } from './tokens'

// Small pieces the scenes compose: labeled chips, capability chips that change tone, and status
// chips under a node. Each starts hidden unless `visible`, for `show` in anim.ts. Widths are
// estimated from character counts, because SVG text can't be measured before it renders:
// JetBrains Mono is about 0.6 em per character.

const MONO_EM = 0.6

export type Tone = 'neutral' | 'blue' | 'danger' | 'success' | 'warn'

const tones: Record<Tone, { bg: string, outline: string, ink: string }> = {
  neutral: { bg: color.white, outline: color.outline3, ink: color.fg2 },
  blue: { bg: color.blueBadgeBg, outline: color.blueBadgeOutline, ink: color.blue },
  danger: { bg: color.dangerSurface, outline: color.dangerOutline, ink: color.danger },
  success: { bg: color.successSurface, outline: color.successOutline, ink: color.success },
  warn: { bg: color.warnSurface, outline: color.warnOutline, ink: color.warn },
}

/** Estimated width of mono text, including its letter spacing in em. */
export function monoWidth(content: string, size: number, spacing = 0): number {
  return content.length * size * (MONO_EM + spacing)
}

export interface ChipOptions {
  x: number
  y: number
  label: string
  tone?: Tone
  size?: number
  icon?: IconName
  anchor?: 'start' | 'middle' | 'end'
  visible?: boolean
  /** Keep the label's case. Chips uppercase by default, as the illustrations' status badges do. */
  keepCase?: boolean
}

/** Width of the chip `chip()` would draw. */
export function chipWidth(o: Pick<ChipOptions, 'label' | 'size' | 'icon' | 'keepCase'>): number {
  const size = o.size ?? 22
  const glyph = o.icon ? size * 1.2 : 0
  const gap = o.icon ? 10 : 0
  return monoWidth(o.keepCase ? o.label : o.label.toUpperCase(), size, 0.04) + glyph + gap + 36
}

/** A rounded label in mono caps. `anchor` places x at its start, middle (default) or end. */
export function chip(parent: Element, o: ChipOptions): SVGGElement {
  const tone = tones[o.tone ?? 'neutral']
  const size = o.size ?? 22
  const label = o.keepCase ? o.label : o.label.toUpperCase()
  const glyph = o.icon ? size * 1.2 : 0
  const gap = o.icon ? 10 : 0
  const w = chipWidth(o)
  const h = size * 1.9
  const left = o.anchor === 'start' ? o.x : o.anchor === 'end' ? o.x - w : o.x - w / 2
  const g = el('g', {}, parent)
  const rect = el('rect', { x: left, y: o.y - h / 2, width: w, height: h, rx: h / 2, 'stroke-width': 2 }, g)
  rect.style.fill = tone.bg
  rect.style.stroke = tone.outline
  if (o.icon)
    icon(g, o.icon, left + 16, o.y - glyph / 2, glyph, tone.ink)
  const t = text(g, label, { x: left + 18 + glyph + gap, y: o.y + 1, class: 'mono', 'font-size': size, 'letter-spacing': '0.04em', 'dominant-baseline': 'central' })
  t.style.fill = tone.ink
  if (!o.visible)
    gsap.set(g, { autoAlpha: 0 })
  return g
}

/** A chip that can change tone: one chip per tone at the same spot, of which one shows. For a capability (verify, store, dedup, retry) that does its work as an event passes. */
export interface ToneChip {
  g: SVGGElement
  variants: Record<Tone, SVGGElement>
  current: Tone
  width: number
}

export function toneChip(parent: Element, o: Omit<ChipOptions, 'tone' | 'visible'> & { visible?: boolean }): ToneChip {
  const g = el('g', {}, parent)
  const variants = {} as Record<Tone, SVGGElement>
  for (const tone of Object.keys(tones) as Tone[]) {
    variants[tone] = chip(g, { ...o, tone, visible: true })
    gsap.set(variants[tone], { autoAlpha: tone === 'neutral' ? 1 : 0 })
  }
  if (!o.visible)
    gsap.set(g, { autoAlpha: 0 })
  return { g, variants, current: 'neutral', width: chipWidth(o) }
}

/** Fades a tone chip to `tone`. */
export function toneTo(tl: gsap.core.Timeline, c: ToneChip, tone: Tone, at: number): number {
  for (const [name, variant] of Object.entries(c.variants))
    tl.to(variant, { autoAlpha: name === tone ? 1 : 0, duration: dur.ui * 0.6 }, at)
  c.current = tone
  return at + dur.ui * 0.6
}

/** A row of chips centered on (x, y), `gap` apart. Returns each by its id. */
export function chipRow(parent: Element, o: { x: number, y: number, items: { id: string, label: string, icon?: IconName }[], size?: number, gap?: number, visible?: boolean }): Record<string, ToneChip> {
  const gap = o.gap ?? 14
  const widths = o.items.map(item => chipWidth({ label: item.label, size: o.size, icon: item.icon }))
  const total = widths.reduce((a, b) => a + b, 0) + gap * (o.items.length - 1)
  let x = o.x - total / 2
  const out: Record<string, ToneChip> = {}
  o.items.forEach((item, i) => {
    out[item.id] = toneChip(parent, { x: x + widths[i] / 2, y: o.y, label: item.label, size: o.size, icon: item.icon, visible: o.visible })
    x += widths[i] + gap
  })
  return out
}

/** A status chip under (or beside) a node, starting hidden. `show`, `hide` and `swap` it. */
export function statusChip(stage: Stage, n: Node, label: string, tone: Tone = 'neutral', size = 22, at?: Point): SVGGElement {
  return chip(stage.overlay, { x: (at ?? n.statusAt).x, y: (at ?? n.statusAt).y, label, tone, size })
}

/** A label on a connector, as a small white chip so the line doesn't run through the text. Starts hidden unless `visible`. */
export function connectorLabel(stage: Stage, o: { x: number, y: number, label: string, tone?: Tone, size?: number, visible?: boolean }): SVGGElement {
  return chip(stage.overlay, { x: o.x, y: o.y, label: o.label, tone: o.tone ?? 'neutral', size: o.size ?? 18, visible: o.visible })
}

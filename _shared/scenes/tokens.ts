import { gsap } from 'gsap'
import { CustomEase } from 'gsap/CustomEase'

// Colors are CSS variables, not literals, so one scene renders in light and dark mode. The
// Hookdeck design system defines the variables (`--bg-0`, `--neutral-fg-1`, ...) and its `.dark`
// class swaps their values; the fallbacks are the light values, for a host without the design
// system. GSAP can't tween between `var(...)` colors, so no primitive tweens a color: a state
// that changes color is built as two layers (a blue packet head and a red one) that fade.
export const color = {
  page: 'var(--tan-bg, #fafaf8)',
  white: 'var(--bg-0, #ffffff)',
  surface: 'var(--bg-1, #fafafa)',
  ink: 'var(--neutral-fg-1, #141412)',
  fg2: 'var(--neutral-fg-2, #52504a)',
  fg3: 'var(--neutral-fg-3, #7a786e)',
  outline1: 'var(--neutral-outline-1, #ebebeb)',
  outline2: 'var(--neutral-outline-2, #e0e0e0)',
  outline3: 'var(--neutral-outline-3, #cccccc)',
  connector: 'var(--sc-connector, #e4e4e1)',
  blue: 'var(--primary-fg, #0044cc)',
  blueBadgeBg: 'var(--blue-badge-bg, #e5ecfa)',
  blueBadgeOutline: 'var(--primary-badge-outline, #ccdaf5)',
  blueSoft: 'var(--sc-blue-soft, #99b4eb)',
  success: 'var(--color-success, #006633)',
  successOutline: 'var(--color-success-outline, #cce6d9)',
  successSurface: 'var(--color-success-surface, #e5f2ec)',
  danger: 'var(--color-danger, #cc2314)',
  dangerOutline: 'var(--color-danger-outline, #f5d3d0)',
  dangerSurface: 'var(--color-danger-surface, #fae9e7)',
  warn: 'var(--sc-warn, #8a5a00)',
  warnOutline: 'var(--sc-warn-outline, #f0dcae)',
  warnSurface: 'var(--sc-warn-surface, #fbf1d9)',
} as const

gsap.registerPlugin(CustomEase)

/** The design system's UI ease, cubic-bezier(0.16, 1, 0.3, 1). */
export const EASE_UI = CustomEase.create('hd-ui', '0.16,1,0.3,1')

export const dur = {
  /** UI changes: fades, state rings, badges. */
  ui: 0.5,
  /** An event travelling along a connector. Slower than UI motion, so the eye can follow it. */
  travel: 1.4,
  /** A payload of several MB: slower, so it reads as heavy. */
  travelBig: 2.6,
  /** A short beat between cause and effect, such as an attempt arriving and the error showing. */
  beat: 0.35,
} as const

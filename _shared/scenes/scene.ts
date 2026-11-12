import { gsap } from 'gsap'
import type { LiveDriver } from './live'
import { type Canvas, createStage, type Stage } from './stage'

// A scene is one GSAP timeline with a label per resting state: `step0` is the scene as it opens,
// and `stepN` is where step N ends. A host calls `goTo` (the website's Back and Next buttons, a
// deck's click counter); the capture script seeks the same timeline frame by frame.
//
// A scene can also have an intro: animation that plays when the scene opens, such as components
// fading onto the stage. `step0` then sits at the intro's end, so opening the scene anywhere but
// live (a retake from mid-way, stepping back) shows the finished state.
//
// A scene can also run live: `scene.live`, when the scene registered one, is a driver that
// launches packets along its edges and sets node badges as real events arrive (live.ts). The
// scripted timeline and the live driver share one set of components and one set of animation
// primitives, so a scene file defines the topology once.

export interface SceneOptions {
  /** On-screen step captions, for silent loops and recordings. */
  captions: boolean
  /** Per-use switches a scene can read, such as `{ unsubscribe: true }`. One scene file can serve two versions with a flag. */
  flags?: Record<string, boolean>
}

export interface Scene {
  name: string
  /** Number of steps (resting states are 0..steps). */
  steps: number
  /** One caption per resting state, `step0` to `stepN`, for a host that shows them outside the SVG (a web page). */
  captions: string[]
  timeline: gsap.core.Timeline
  /** Timeline time of each resting state, `step0` to `stepN`. */
  stepTimes: number[]
  /** Shows step `n`. Animates when moving forward one step, and jumps otherwise (stepping back, or opening mid-way). */
  goTo: (n: number, opts?: { animate?: boolean }) => void
  /** Plays the intro from the start, ending at `step0`. Does nothing for a scene without one. */
  playIntro: () => void
  /** Stops any playback and pauses the timeline, so a caller (the capture script) can seek it frame by frame. */
  stop: () => void
  /** The live driver, for a scene that supports live events. */
  live?: LiveDriver
  destroy: () => void
}

export interface SceneBuild {
  stage: Stage
  tl: gsap.core.Timeline
  options: SceneOptions
  /** Adds the intro, from time 0. Call it once, before any `step`. `animate` returns when it ends. */
  intro: (animate: (at: number) => number) => void
  /** Adds the next step. `animate` receives the step's start time and returns when it ends. */
  step: (animate: (at: number) => number) => void
  /** Registers the live driver built on this scene's components. */
  live: (driver: LiveDriver) => void
}

export type SceneFactory = ((host: HTMLElement, options: SceneOptions) => Scene) & { sceneName?: string }

export interface SceneConfig {
  /** The stage's size: the slides' 1920×1080 by default. A portrait layout for a web page passes its own. */
  canvas?: Canvas
}

/** A small gap after each resting state, so nothing in step N+1 renders when seeking to step N exactly. */
const STEP_GAP = 0.05

declare global {
  interface Window { __scenes?: Record<string, Scene> }
}

export function defineScene(name: string, build: (b: SceneBuild) => void, config: SceneConfig = {}): SceneFactory {
  const factory: SceneFactory = (host, options) => {
    const stage = createStage(host, config.canvas)
    const tl = gsap.timeline({ paused: true })
    const stepTimes = [0]
    let driver: LiveDriver | undefined
    tl.addLabel('step0', 0)

    build({
      stage,
      tl,
      options,
      intro(animate) {
        if (stepTimes.length > 1)
          throw new Error(`Scene "${name}": add the intro before the steps`)
        stepTimes[0] = Math.max(animate(0), tl.duration())
        tl.addLabel('step0', stepTimes[0])
      },
      step(animate) {
        const start = stepTimes[stepTimes.length - 1] + STEP_GAP
        const end = Math.max(animate(start), tl.duration())
        stepTimes.push(end)
        tl.addLabel(`step${stepTimes.length - 1}`, end)
      },
      live(d) {
        driver = d
      },
    })

    const steps = stepTimes.length - 1
    let current = 0
    let playing: gsap.core.Tween | null = null

    const scene: Scene = {
      name,
      steps,
      captions: stage.captionLines,
      timeline: tl,
      stepTimes,
      live: driver,
      goTo(n, { animate = false } = {}) {
        const target = Math.max(0, Math.min(steps, n))
        playing?.kill()
        playing = null
        if (animate && target === current + 1)
          playing = tl.tweenTo(`step${target}`, { ease: 'none' })
        else
          tl.seek(`step${target}`)
        current = target
      },
      playIntro() {
        playing?.kill()
        tl.seek(0)
        playing = tl.tweenTo('step0', { ease: 'none' })
        current = 0
      },
      stop() {
        playing?.kill()
        playing = null
        tl.pause()
      },
      destroy() {
        playing?.kill()
        driver?.destroy()
        tl.kill()
        stage.destroy()
        if (window.__scenes?.[name] === scene)
          delete window.__scenes[name]
      },
    }

    window.__scenes ??= {}
    window.__scenes[name] = scene
    return scene
  }
  factory.sceneName = name
  return factory
}

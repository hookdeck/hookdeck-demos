import { createFlowFeed, formatBytes } from './kit/host/flow-feed'
import * as lc from './livekit-calls'

// What the demo page's bundle exposes as `HookdeckScenes` (scripts/build-scenes.mjs). Page code
// (public/topology.js) picks scenes by name; a `-mobile` twin exists for each.

export const scenes = {
  'live': lc.createLiveScene,
  'live-mobile': lc.createLiveMobileScene,
  'livekit-call-lifecycle': lc.createCallLifecycleScene,
  'livekit-call-lifecycle-mobile': lc.createCallLifecycleMobileScene,
  'livekit-duplicate-dropped': lc.createDuplicateScene,
  'livekit-duplicate-dropped-mobile': lc.createDuplicateMobileScene,
  'livekit-bad-signature': lc.createBadSignatureScene,
  'livekit-bad-signature-mobile': lc.createBadSignatureMobileScene,
  'livekit-app-down': lc.createAppDownScene,
  'livekit-app-down-mobile': lc.createAppDownMobileScene,
}

/** The platform's name, shown in the square captures' eyebrow: "{ Hookdeck + LiveKit }". */
export const brand = 'LiveKit'

/** The scripted scenarios, in the order the page and the capture script list them. */
export const scenarios = [
  { id: 'livekit-call-lifecycle', title: 'Call lifecycle', captions: lc.callLifecycleCaptions },
  { id: 'livekit-duplicate-dropped', title: 'Duplicate dropped', captions: lc.duplicateCaptions },
  { id: 'livekit-bad-signature', title: 'Bad signature', captions: lc.badSignatureCaptions },
  { id: 'livekit-app-down', title: 'App down, retry succeeds', captions: lc.appDownCaptions },
] as const

/** Below this width (CSS px) a page uses the `-mobile` layout, as the website does. */
export const PHONE_BREAKPOINT = 700

export const desktopCrop = lc.desktopCrop
export { createFlowFeed, formatBytes }

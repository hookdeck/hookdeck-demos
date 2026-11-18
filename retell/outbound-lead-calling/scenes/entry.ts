import { createFlowFeed, formatBytes } from './kit/host/flow-feed'
import * as rc from './retell-calls'

// What the demo page's bundle exposes as `HookdeckScenes` (scripts/build-scenes.mjs). Page code
// (public/topology.js) picks scenes by name; a `-mobile` twin exists for each.

export const scenes = {
  'live': rc.createLiveScene,
  'live-mobile': rc.createLiveMobileScene,
  'retell-call-lifecycle': rc.createCallLifecycleScene,
  'retell-call-lifecycle-mobile': rc.createCallLifecycleMobileScene,
  'retell-duplicate-dropped': rc.createDuplicateScene,
  'retell-duplicate-dropped-mobile': rc.createDuplicateMobileScene,
  'retell-bad-signature': rc.createBadSignatureScene,
  'retell-bad-signature-mobile': rc.createBadSignatureMobileScene,
  'retell-app-down': rc.createAppDownScene,
  'retell-app-down-mobile': rc.createAppDownMobileScene,
  // The tutorial's opening diagram (deployed). Not a tab in the demo page, which shows what runs.
  'retell-deployed': rc.createDeployedScene,
  'retell-deployed-mobile': rc.createDeployedMobileScene,
}

/** The platform's name, shown in the square captures' eyebrow: "{ Hookdeck + Retell }". */
export const brand = 'Retell'

/** The scripted scenarios, in the order the page and the capture script list them. */
export const scenarios = [
  { id: 'retell-call-lifecycle', title: 'Call lifecycle', captions: rc.callLifecycleCaptions },
  { id: 'retell-duplicate-dropped', title: 'Duplicate dropped', captions: rc.duplicateCaptions },
  { id: 'retell-bad-signature', title: 'Bad signature', captions: rc.badSignatureCaptions },
  { id: 'retell-app-down', title: 'App down, retry succeeds', captions: rc.appDownCaptions },
] as const

/** Below this width (CSS px) a page uses the `-mobile` layout, as the website does. */
export const PHONE_BREAKPOINT = 700

export const desktopCrop = rc.desktopCrop
export { createFlowFeed, formatBytes }

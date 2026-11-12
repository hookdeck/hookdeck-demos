import { createFlowFeed, formatBytes } from './kit/host/flow-feed'
import * as pc from './post-call'

// What the demo page's bundle exposes as `HookdeckScenes` (scripts/build-scenes.mjs). Page code
// (public/topology.js) picks scenes by name; a `-mobile` twin exists for each.

export const scenes = {
  'live': pc.createLiveScene,
  'live-mobile': pc.createLiveMobileScene,
  'delivery': pc.createDeliveryScene,
  'delivery-mobile': pc.createDeliveryMobileScene,
  'duplicate': pc.createDuplicateScene,
  'duplicate-mobile': pc.createDuplicateMobileScene,
  'bad-signature': pc.createBadSignatureScene,
  'bad-signature-mobile': pc.createBadSignatureMobileScene,
  'app-down': pc.createAppDownScene,
  'app-down-mobile': pc.createAppDownMobileScene,
}

/** The scripted scenarios, in the order the page and the capture script list them. */
export const scenarios = [
  { id: 'delivery', title: 'Delivery', captions: pc.deliveryCaptions },
  { id: 'duplicate', title: 'Duplicate dropped', captions: pc.duplicateCaptions },
  { id: 'bad-signature', title: 'Bad signature', captions: pc.badSignatureCaptions },
  { id: 'app-down', title: 'App down, retry succeeds', captions: pc.appDownCaptions },
] as const

/** Below this width (CSS px) a page uses the `-mobile` layout, as the website does. */
export const PHONE_BREAKPOINT = 700

export const desktopCrop = pc.desktopCrop
export { createFlowFeed, formatBytes }

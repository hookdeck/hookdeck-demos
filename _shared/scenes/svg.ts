import mic from '@material-symbols/svg-400/outlined/mic.svg?raw'
import terminal from '@material-symbols/svg-400/outlined/terminal.svg?raw'
import dns from '@material-symbols/svg-400/outlined/dns.svg?raw'
import check from '@material-symbols/svg-400/outlined/check.svg?raw'
import priorityHigh from '@material-symbols/svg-400/outlined/priority_high.svg?raw'
import webhook from '@material-symbols/svg-400/outlined/webhook.svg?raw'
import smartToy from '@material-symbols/svg-400/outlined/smart_toy.svg?raw'
import storage from '@material-symbols/svg-400/outlined/storage.svg?raw'
import verifiedUser from '@material-symbols/svg-400/outlined/verified_user.svg?raw'
import fingerprint from '@material-symbols/svg-400/outlined/fingerprint.svg?raw'
import contentCopy from '@material-symbols/svg-400/outlined/content_copy.svg?raw'
import autorenew from '@material-symbols/svg-400/outlined/autorenew.svg?raw'
import block from '@material-symbols/svg-400/outlined/block.svg?raw'
import gppBad from '@material-symbols/svg-400/outlined/gpp_bad.svg?raw'
import warning from '@material-symbols/svg-400/outlined/warning.svg?raw'
import hourglassTop from '@material-symbols/svg-400/outlined/hourglass_top.svg?raw'
import database from '@material-symbols/svg-400/outlined/database.svg?raw'
import inbox from '@material-symbols/svg-400/outlined/inbox.svg?raw'
import desktopWindows from '@material-symbols/svg-400/outlined/desktop_windows.svg?raw'
import bolt from '@material-symbols/svg-400/outlined/bolt.svg?raw'
import closeIcon from '@material-symbols/svg-400/outlined/close.svg?raw'
import laptopMac from '@material-symbols/svg-400/outlined/laptop_mac.svg?raw'
import cloudOff from '@material-symbols/svg-400/outlined/cloud_off.svg?raw'
import schedule from '@material-symbols/svg-400/outlined/schedule.svg?raw'
import errorIcon from '@material-symbols/svg-400/outlined/error.svg?raw'
import syncIcon from '@material-symbols/svg-400/outlined/sync.svg?raw'
import recordVoiceOver from '@material-symbols/svg-400/outlined/record_voice_over.svg?raw'
import policyIcon from '@material-symbols/svg-400/outlined/policy.svg?raw'

const NS = 'http://www.w3.org/2000/svg'

export type Attrs = Record<string, string | number>

export function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}, parent?: Element): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag)
  for (const [key, value] of Object.entries(attrs))
    node.setAttribute(key, String(value))
  parent?.appendChild(node)
  return node
}

export function text(parent: Element, content: string, attrs: Attrs = {}): SVGTextElement {
  const node = el('text', attrs, parent)
  node.textContent = content
  return node
}

// Material Symbols Outlined (the design system's icon set), inlined as paths like production does.
const icons = {
  'mic': mic,
  'terminal': terminal,
  'dns': dns,
  'check': check,
  'priority_high': priorityHigh,
  'webhook': webhook,
  'smart_toy': smartToy,
  'storage': storage,
  'verified_user': verifiedUser,
  'fingerprint': fingerprint,
  'content_copy': contentCopy,
  'autorenew': autorenew,
  'block': block,
  'gpp_bad': gppBad,
  'warning': warning,
  'hourglass_top': hourglassTop,
  'database': database,
  'inbox': inbox,
  'desktop_windows': desktopWindows,
  'bolt': bolt,
  'close': closeIcon,
  'laptop_mac': laptopMac,
  'cloud_off': cloudOff,
  'schedule': schedule,
  'error': errorIcon,
  'sync': syncIcon,
  'record_voice_over': recordVoiceOver,
  'policy': policyIcon,
}

/** The Hookdeck mark, from the design system's logo-icon.svg (26 by 18). */
const HOOKDECK_MARK = 'M19.686 6.45611C19.8249 6.45611 19.9638 6.56138 20.0333 6.70173C20.1027 6.84208 20.068 7.01751 19.9638 7.12278L11.2817 15.8947C8.88539 18.3158 4.96106 18.3158 2.56478 15.8947C0.16851 13.4737 0.16851 9.50874 2.56478 7.08769L7.5657 2.03506C8.98957 0.596462 10.9344 0.0350587 12.775 0.280673C12.9139 0.31576 13.0181 0.385935 13.0875 0.526286C13.1223 0.666637 13.0875 0.80699 12.9834 0.912253L11.872 2.03506C11.6984 2.2105 11.49 2.31576 11.2817 2.35085C10.4482 2.4912 9.64942 2.87716 9.0243 3.50874L4.02338 8.56138C2.42587 10.1754 2.42587 12.807 4.02338 14.421C5.6209 16.0351 8.22554 16.0351 9.82306 14.421L16.0395 8.14032L15.0323 7.12278C14.9282 7.01751 14.8934 6.84208 14.9629 6.70173C15.0324 6.56138 15.1713 6.45611 15.3102 6.45611H19.686ZM10.726 11.5438C10.8649 11.5438 11.0038 11.4386 11.0733 11.2982C11.1427 11.1579 11.108 10.9824 11.0038 10.8772L9.9967 9.85962L16.2131 3.57892C17.8106 1.96488 20.4153 1.96488 22.0128 3.57892C23.6103 5.19295 23.6103 7.82453 22.0128 9.43857L16.9771 14.4912C16.352 15.1228 15.5533 15.5087 14.7198 15.6491C14.4767 15.6842 14.2683 15.7894 14.1294 15.9649L13.0181 17.0877C12.9139 17.193 12.8792 17.3333 12.9139 17.4737C12.9486 17.614 13.0876 17.7193 13.2265 17.7193C15.0671 17.9649 17.0119 17.4035 18.4358 15.9649L23.4367 10.9123C25.8329 8.4912 25.8329 4.52629 23.4367 2.10523C21.0404 -0.31582 17.1161 -0.31582 14.7198 2.10523L6.03764 10.8772C5.93346 10.9824 5.89873 11.1579 5.96819 11.2982C6.03764 11.4386 6.17656 11.5438 6.31547 11.5438H10.726Z'

export type IconName = keyof typeof icons | 'hookdeck'

/** Draws a Material Symbol `size` px square with its top-left corner at (x, y). 'hookdeck' draws the brand mark, `size` wide. */
export function icon(parent: Element, name: IconName, x: number, y: number, size: number, fill: string): SVGSVGElement {
  if (name === 'hookdeck') {
    const mark = el('svg', { x, y: y + (size - size * 18 / 26) / 2, width: size, height: size * 18 / 26, viewBox: '0 0 26 18', overflow: 'visible' }, parent)
    mark.style.fill = fill
    el('path', { d: HOOKDECK_MARK }, mark)
    return mark
  }
  const d = icons[name].match(/ d="([^"]+)"/)?.[1]
  if (!d)
    throw new Error(`No path in icon ${name}`)
  const box = el('svg', { x, y, width: size, height: size, viewBox: '0 -960 960 960', overflow: 'visible' }, parent)
  box.style.fill = fill
  el('path', { d }, box)
  return box
}

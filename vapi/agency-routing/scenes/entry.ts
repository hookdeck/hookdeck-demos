import { createFlowFeed as createKitFeed, type FeedMessage, type FlowFeedOptions, formatBytes } from './kit/host/flow-feed'
import * as vr from './vapi-routing'

// What the demo page's bundle exposes as `HookdeckScenes` (scripts/build-scenes.mjs). Page code
// (public/topology.js) picks scenes by name; a `-mobile` twin exists for each.

export const scenes = {
  'live': vr.createLiveScene,
  'live-mobile': vr.createLiveMobileScene,
  'vapi-call-and-tool': vr.createCallAndToolScene,
  'vapi-call-and-tool-mobile': vr.createCallAndToolMobileScene,
  'vapi-two-clients': vr.createTwoClientsScene,
  'vapi-two-clients-mobile': vr.createTwoClientsMobileScene,
  'vapi-duplicate-dropped': vr.createDuplicateScene,
  'vapi-duplicate-dropped-mobile': vr.createDuplicateMobileScene,
  'vapi-bad-signature': vr.createBadSignatureScene,
  'vapi-bad-signature-mobile': vr.createBadSignatureMobileScene,
  'vapi-app-down': vr.createAppDownScene,
  'vapi-app-down-mobile': vr.createAppDownMobileScene,
}

/** The platform's name, shown in the square captures' eyebrow: "{ Hookdeck + Vapi }". */
export const brand = 'Vapi'

/** The scripted scenarios, in the order the page and the capture script list them. */
export const scenarios = [
  { id: 'vapi-call-and-tool', title: 'Call and async tool', captions: vr.callAndToolCaptions },
  { id: 'vapi-two-clients', title: 'Two clients', captions: vr.twoClientsCaptions },
  { id: 'vapi-duplicate-dropped', title: 'Duplicate dropped', captions: vr.duplicateCaptions },
  { id: 'vapi-bad-signature', title: 'Bad signature', captions: vr.badSignatureCaptions },
  { id: 'vapi-app-down', title: 'App down, retry succeeds', captions: vr.appDownCaptions },
] as const

/** Below this width (CSS px) a page uses the `-mobile` layout, as the website does. */
export const PHONE_BREAKPOINT = 700

export const desktopCrop = vr.desktopCrop
export { formatBytes }

// ---- The live feed: one shared flow feed per client ----
//
// The scene has one row of nodes per client. The kit's feed drives one set of node and edge ids, so
// the page runs one feed for each client, each reading only that client's messages (the flow state
// carries the Hookdeck source each request came through; the app's delivery log carries the client).

const CLIENTS = [
  { slug: 'acme', source: 'vapi-acme-dental' },
  { slug: 'globex', source: 'vapi-globex-plumbing' },
] as const

/** The pane's packet label for a message: the short name and its size, e.g. "ended 18 KB". */
function packetLabel(m: Pick<FeedMessage, 'label' | 'bytes'>): string {
  const kind = m.label.startsWith('status-update') ? m.label.replace(/^status-update · /, '')
    : m.label === 'end-of-call-report' ? 'report'
    : m.label.replace(/ · .*$/, '')
  const size = formatBytes(m.bytes)
  return size ? `${kind} ${size}` : kind
}

// One round of requests serves both feeds.
const memo = new Map<string, { at: number, json: Promise<any> }>()
function sharedJson(url: string): Promise<any> {
  const hit = memo.get(url)
  if (hit && Date.now() - hit.at < 400) return hit.json
  const json = fetch(url, { cache: 'no-store' }).then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
  memo.set(url, { at: Date.now(), json })
  return json
}

/** A fetch that gives one client's share of /api/flow and /api/deliveries. */
function fetchFor(client: typeof CLIENTS[number]): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    try {
      const data = await sharedJson(String(input))
      const own = Array.isArray(data)
        ? data.filter(d => d.client === client.slug)
        : { ...data, messages: (data.messages ?? []).filter((m: any) => m.source === client.source) }
      return new Response(JSON.stringify(own), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    catch {
      return new Response('{}', { status: 502 })
    }
  }) as typeof fetch
}

export function createFlowFeed(options: FlowFeedOptions) {
  const feeds = CLIENTS.map(client => createKitFeed({
    ...options,
    packetLabel,
    fetchImpl: fetchFor(client),
    ids: {
      sender: `agent_${client.slug}`, gateway: 'gateway', listen: 'listen', app: `app_${client.slug}`,
      in: `in_${client.slug}`, out: `out_${client.slug}`, local: `local_${client.slug}`,
      verify: 'verify', store: 'store', dedup: 'dedup', retry: 'retry',
    },
  }))
  const newest = () => feeds.map(f => f.latest()).filter((m): m is FeedMessage => !!m).sort((a, b) => a.received_at.localeCompare(b.received_at)).pop()
  return {
    start() { for (const f of feeds) f.start() },
    stop() { for (const f of feeds) f.stop() },
    latest: newest,
    messages: () => feeds.flatMap(f => f.messages()).sort((a, b) => a.received_at.localeCompare(b.received_at)),
    lastAppActivity: () => Math.max(...feeds.map(f => f.lastAppActivity())),
    replay(request_id?: string) {
      const target = request_id ? feeds.find(f => f.messages().some(m => m.request_id === request_id)) : feeds.find(f => f.latest() === newest())
      return target ? target.replay(request_id) : false
    },
  }
}

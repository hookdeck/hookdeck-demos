# Flow drawer

A bottom drawer, closed by default, that shows each message moving from a sending platform through Event Gateway to the demo app, live: request received, verified or rejected (401), event, delivery attempts (status, latency, retries), the app's result, and any call the app makes back to the platform while handling it.

Two pieces, both copied into a demo by `npm run sync-shared` (see the manifest):

| Piece | Source | Goes to | What it is |
|---|---|---|---|
| `flow-drawer` | `client/` | `public/flow-drawer/` | `flow-drawer.js` and `flow-drawer.css`, no dependencies. Needs the design system (`ds`) loaded first. |
| `flow-drawer-server` | `server.ts` | `src/flow-drawer-server.ts` | `createFlowState()`: reads Event Gateway requests, events and attempts with the project API key and merges in the app's own feed. Needs Node 22 (`fetch`). |

Nothing here is specific to a platform. The demo passes its sources, labels and an app-side feed:

```ts
import { createFlowState } from './flow-drawer-server';

const flow = createFlowState({
  apiKey: process.env.HOOKDECK_API_KEY!,
  senderLabel: 'Vapi',
  appLabel: 'Demo app',
  sources: [{ name: 'my-source', label: 'Client A' }],       // Hookdeck source names
  describeRequest: ({ body }) => ({ label: body.type, group: body.id }),
  appEntries: () => app_feed,                                // AppFlowEntry[] kept by the app
});
app.get('/api/flow', flow.handler);
```

```html
<link rel="stylesheet" href="ds/styles.css">
<link rel="stylesheet" href="flow-drawer/flow-drawer.css">
<script src="flow-drawer/flow-drawer.js"></script>
<script>FlowDrawer.mount({ endpoint: '/api/flow' });</script>
```

The app feed has two kinds of entry (`AppFlowEntry` in `server.ts`):

- `result`: what the app answered for a delivery. Set `event_id` from the `x-hookdeck-eventid` header Event Gateway adds to each delivery.
- `outbound`: a call the app made while handling a delivery (for example back to the platform). Set `parent_event_id` to that event.

Open the page with `?flow=open` to start with the drawer open. The API key never reaches the browser.

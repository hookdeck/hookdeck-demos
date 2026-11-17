# Vapi agency routing

A voice AI agency routes each client's Vapi call events to that client's endpoint through Hookdeck, with an async tool that returns its result into the live call.

## Set up

1. Copy `.env.example` to `.env` and set `VAPI_API_KEY` (private), `VAPI_PUBLIC_KEY` (public, for the Start call buttons) and `HOOKDECK_API_KEY`. Both Vapi keys are at https://dashboard.vapi.ai/org/api-keys.
2. `npm install`, then `npm run setup` (creates the Hookdeck sources and connections and the Vapi credential, tool and assistants).
3. `npm run listen` in one terminal and `npm start` in another.
4. Open http://localhost:4000. The **Data flow** pane at the bottom is open by default and shows each webhook moving from Vapi through Event Gateway to the client's endpoint. `npm run simulate` replays a signed sample call without a microphone (`-- globex` for the other client, `--duplicate` to send the end-of-call report twice); `npm run probe` checks that a correctly signed request is accepted and a badly signed one gets 401.

Run one `hookdeck listen` for these sources. Each running `hookdeck listen` gets its own copy of every event, so a second one makes the app receive each webhook twice.

## Make a test call

No Vapi dashboard needed.

1. Open http://localhost:4000.
2. On the Acme Dental card, click **Call Acme Dental** (**Plug in and call** in the default Switchboard theme) and allow microphone access. You are the caller; the card names the assistant you are ringing.
3. Say: "Hi, I'm Priya Shah, what's my next appointment?" The assistant says it is checking, then stays quiet; about 6 seconds later the CRM result is spoken into the call. The **While you wait** panel on the card shows the tool request, the CRM delay counting down and the result being posted to the call's `controlUrl`.
4. Click **End call** (**Pull the plug**). Repeat in the Globex Plumbing column with: "Hi, I'm Maria Lopez, when is my plumber coming?"

Each column shows the events that arrived through that client's Hookdeck source. The page loads the Vapi Web SDK (`@vapi-ai/web`, pinned) from esm.sh; the server only exposes `VAPI_PUBLIC_KEY` and the assistant IDs at `/api/config`.

## Themes and the focused layout

The page has System, Light, Dark and Switchboard themes; Switchboard (the agency as a telephone exchange, each client a numbered line) is the default. The theme switch is `public/theme.js`, copied from `_shared/theme/`; the Switchboard look and wording are in `public/theme-switchboard.css` and `public/theme-switchboard.copy.js`, and apply only to the main view, never the Data flow pane. Explanations sit behind ⓘ buttons: a "How this demo works" dialog by the title, and hover tips by the failure injection and log headings (`public/info.js`).

## Data flow pane

The pane has a Live tab and one tab per scripted scene. Live animates the real webhooks as they arrive. There is one row for each client (assistant, Event Gateway source and endpoint), and the lookup result goes back into the call on the `controlUrl` connector. Click a packet or a node to see that webhook below the diagram, with whether Event Gateway verified it, each delivery attempt and its status, what the endpoint answered, and a **View in Hookdeck** link.

The failure injection card on each client shows up as a `failing next N` badge on that client's endpoint. The scripted scenes play the same topology step by step with a caption for each step:

| Scene | What it shows |
| --- | --- |
| Call and async tool | One call to Acme Dental: `status-update`, the `lookup_customer` tool call, the result posted to `controlUrl`, then `status-update` (ended) and `end-of-call-report` |
| Two clients | Each client's calls and results use that client's own source and endpoint |
| Duplicate dropped | A repeated `end-of-call-report` is dropped by the deduplication rule |
| Bad signature | A request with the wrong signature gets a 401 and no event is created |
| App down, retry succeeds | The endpoint answers 503, Event Gateway retries, and the second attempt succeeds |

MP4 captures of each scene, landscape and square, are in `scenes/captures/`. Re-create them with `npm run capture` and `ASPECT=square npm run capture`. The scene kit in `scenes/kit/` and the pane in `public/topology-pane/` are copied from `_shared/` by `node scripts/sync-shared.mjs` at the repository root; edit the scene in `scenes/vapi-routing.ts`.

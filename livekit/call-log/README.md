# LiveKit call log with Hookdeck

A call log built from LiveKit webhooks. LiveKit Cloud sends room, participant and egress (recording) events to a Hookdeck source. Hookdeck delivers them to this app, which builds one entry per room session: start, end, duration, participants and recording links.

```
LiveKit Cloud --webhook--> Hookdeck source --> hookdeck listen --> this app (:4000)
```

The demo has three parts: this app, LiveKit Cloud and Hookdeck Event Gateway.

## What it shows

- **Raw-body verification.** LiveKit signs each webhook with a JWT in the `Authorization` header, and the JWT includes a SHA-256 hash of the body. The app verifies it with `WebhookReceiver` from `livekit-server-sdk` on the raw body (`application/webhook+json` is not parsed by `express.json()`).
- **Idempotent call log.** Each event is applied as a set-this-field update keyed by the room session id, so a duplicate delivery, a retry or an event that arrives out of order leaves the log correct. See [`src/call-log.ts`](src/call-log.ts).
- **Delivery list.** The page lists every request the app received and whether it was applied, a duplicate or rejected.
- **Event Gateway rules.** The connection deduplicates on the LiveKit event id (`body.id`, 10 minutes) and retries failed deliveries with exponential backoff (8 attempts from 30 seconds).
- **A data flow pane.** The page's bottom pane shows each webhook travelling from LiveKit Cloud through Event Gateway and `hookdeck listen` to the app, with scripted scenes for a call's lifecycle, a duplicate, a bad signature and an app that is down.

## Setup

### 1. Install

```bash
npm install
cp .env.example .env
```

### 2. Add your keys to `.env`

| Variable | Where to get it |
|---|---|
| `LIVEKIT_URL` | LiveKit Cloud dashboard, Settings, API keys: the project's WebSocket URL (`wss://<project>.livekit.cloud`) |
| `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | The same page: create a key pair. The secret is shown once |
| `HOOKDECK_API_KEY` | Hookdeck dashboard, Project settings, API keys |

### 3. Create the Hookdeck connection

```bash
npm run setup
```

This creates a `livekit-call-log` source, a CLI destination that forwards to `/webhooks/livekit`, and the connection between them with a deduplicate rule and a retry rule. It writes the source URL to `LIVEKIT_WEBHOOK_URL` in `.env`. The script is idempotent. It logs the bundled Hookdeck CLI in to the project for `HOOKDECK_API_KEY` with a config file of its own, so your interactive `hookdeck login` is untouched.

### 4. Add the webhook in LiveKit Cloud

In the LiveKit Cloud dashboard open **Settings, Webhooks** and select **Create new webhook**. Enter a name, paste the `LIVEKIT_WEBHOOK_URL` value as the URL, choose your API key as the **Signing API key**, and select **Create**. Use **Actions, Send a test event** to check the path.

See LiveKit's [webhooks documentation](https://docs.livekit.io/intro/basics/rooms-participants-tracks/webhooks-events/) for the events and payloads.

### 5. Run it

In two terminals:

```bash
npm run listen   # hookdeck listen: forwards the source to localhost:4000
npm start        # the app
```

Open <http://localhost:4000>.

## The data flow pane

The page has a **Data flow** pane at the bottom, open by default. **Live** shows the demo as it runs: each webhook travels from LiveKit Cloud through Event Gateway (receive, store, dedup, retry) and `hookdeck listen` to the app. Click a node or a packet for that webhook's details below the diagram: each delivery attempt, what the app answered and a **View in Hookdeck** link. The other tabs play scripted scenes with captions: **Call lifecycle**, **Duplicate dropped**, **Bad signature** and **App down, retry succeeds**.

The scenes live in `scenes/livekit-calls.ts` (the kit in `scenes/kit/` is synced from `_shared/scenes`). MP4 captures of the four scenes, landscape and square, are in `scenes/captures/`. To render them again: `npm run capture -- livekit-call-lifecycle`.

## Generate activity

Install the [LiveKit CLI](https://docs.livekit.io/home/cli/) (`brew install livekit-cli`), then:

```bash
npm run activity
```

The script creates a room, joins two test participants with demo media, and lets them leave. The call log shows the room appear, the participants join and leave, and the room finish. Pass a room name and a duration in seconds: `npm run activity -- standup 30`.

To end a call immediately, delete the room:

```bash
lk room delete <room-name>
```

### Without a LiveKit room

`npm run simulate` sends correctly signed events to your Hookdeck source, signed the way LiveKit signs them (a JWT in the `Authorization` header with a `sha256` claim for the body). Use it to try the duplicate and bad-signature paths:

```bash
npm run simulate                                    # room_started, participant_joined, participant_left, room_finished
npm run simulate -- room_finished --twice           # the second request is deduplicated by Event Gateway
npm run simulate -- room_finished --bad-signature   # the app rejects it with 401
```

**A failing app.** In the page's failure injection panel, set "Fail the next" to 2 and generate some activity. The app answers 503 to the first two deliveries. Hookdeck keeps the event, retries it, and the call log updates when the app finally answers 200. LiveKit is never kept waiting. Set "Delay each answer" to make the app slow instead.

### Recordings

Recording links come from egress events. Start a room composite egress with an output location you control (see LiveKit's [egress documentation](https://docs.livekit.io/home/egress/overview/)); when it ends, `egress_ended` carries the file location and the app adds it to the call.

## Tests

```bash
npm test
```

The tests build a call log from a sample event sequence, then check that duplicates, reverse order and a late `egress_updated` give the same result, and that `WebhookReceiver` accepts a signed body and rejects an altered one. The scene and pane tests run in a browser: install one with `npx playwright install chromium` first.

## Replaying a delivery

Every request the app receives is appended to `data/deliveries.jsonl` with its headers and raw body (base64), so a delivery can be replayed through a verifier later. To replay an event from Hookdeck, open it in the dashboard and select **Retry**, or run `hookdeck gateway event retry <event-id>`.

## Project structure

```
livekit/call-log/
├── .env.example
├── package.json
├── scenes/
│   ├── livekit-calls.ts     # The topology: live scene and four scripted scenes
│   ├── entry.ts             # What the page's bundle exposes
│   ├── captures/            # MP4s, landscape and square
│   └── kit/                 # Synced from _shared/scenes
├── scripts/
│   ├── activity.sh          # Creates a room and joins test participants with the lk CLI
│   ├── simulate.ts          # Sends signed events (or a bad signature, or a duplicate) to the source
│   ├── hookdeck-cli.ts      # Synced from _shared: runs the Hookdeck CLI against the API key's project
│   ├── listen.ts            # npm run listen
│   └── setup-hookdeck.ts    # npm run setup
├── src/
│   ├── call-log.ts          # Turns events into calls (idempotent, order-independent)
│   ├── server.ts            # Express app and the verified webhook endpoint
│   ├── deliveries.ts        # What the app answered, for the data flow pane
│   └── store.ts             # JSON file persistence in data/
├── test/                    # Call log, scenes and pane tests
└── public/                  # The call log page and the data flow pane
```

<!--
TODO(hookdeck/core#6254): publish this section when the LiveKit source type ships, then
delete the comment markers. Also add LIVEKIT_SOURCE_TYPE to .env.example.

## Verify in Event Gateway with the LiveKit source type

The setup above uses a generic source and the app verifies each delivery. With the LiveKit source type, Hookdeck verifies the signature at the source using your API key and secret, so a request that fails verification never reaches your app. This is a one-step change:

1. Add `LIVEKIT_SOURCE_TYPE=LIVEKIT` to `.env` and run `npm run setup` again.

The app keeps verifying with `WebhookReceiver`, which works the same way because Hookdeck forwards the `Authorization` header and the raw body unchanged.
-->

## Troubleshooting

- **Webhook not arriving:** check that `npm run listen` is running and that the Hookdeck dashboard shows the event. Use **Actions, Send a test event** in LiveKit Cloud.
- **Deliveries rejected with 401:** the API key selected as **Signing API key** in LiveKit must match `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` in `.env`.
- **`lk` can't connect:** `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` must be set in `.env`; the script loads them.

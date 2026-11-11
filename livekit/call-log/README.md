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

This creates a `livekit-call-log` source, a CLI destination that forwards to `/webhooks/livekit`, and the connection between them. It writes the source URL to `LIVEKIT_WEBHOOK_URL` in `.env`. The script is idempotent. It logs the bundled Hookdeck CLI in to the project for `HOOKDECK_API_KEY` with a config file of its own, so your interactive `hookdeck login` is untouched.

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

### Recordings

Recording links come from egress events. Start a room composite egress with an output location you control (see LiveKit's [egress documentation](https://docs.livekit.io/home/egress/overview/)); when it ends, `egress_ended` carries the file location and the app adds it to the call.

## Tests

```bash
npm test
```

The tests build a call log from a sample event sequence, then check that duplicates, reverse order and a late `egress_updated` give the same result, and that `WebhookReceiver` accepts a signed body and rejects an altered one.

## Replaying a delivery

Every request the app receives is appended to `data/deliveries.jsonl` with its headers and raw body (base64), so a delivery can be replayed through a verifier later. To replay an event from Hookdeck, open it in the dashboard and select **Retry**, or run `hookdeck gateway event retry <event-id>`.

## Project structure

```
livekit/call-log/
├── .env.example
├── package.json
├── scripts/
│   ├── activity.sh          # Creates a room and joins test participants with the lk CLI
│   ├── hookdeck-cli.ts      # Runs the bundled Hookdeck CLI against the API key's project
│   ├── listen.ts            # npm run listen
│   └── setup-hookdeck.ts    # npm run setup
├── src/
│   ├── call-log.ts          # Turns events into calls (idempotent, order-independent)
│   ├── server.ts            # Express app and the verified webhook endpoint
│   └── store.ts             # JSON file persistence in data/
├── test/call-log.test.ts
└── public/                  # The call log page
```

<!--
TODO(hookdeck/core#6254): publish this section when the LiveKit source type ships, then
delete the comment markers. Also add LIVEKIT_SOURCE_TYPE to .env.example.

## Verify at the edge with the LiveKit source type

The setup above uses a generic source and the app verifies each delivery. With the LiveKit source type, Hookdeck verifies the signature at the source using your API key and secret, so a request that fails verification never reaches your app. This is a one-step change:

1. Add `LIVEKIT_SOURCE_TYPE=LIVEKIT` to `.env` and run `npm run setup` again.

The app keeps verifying with `WebhookReceiver`, which works the same way because Hookdeck forwards the `Authorization` header and the raw body unchanged.
-->

## Troubleshooting

- **Webhook not arriving:** check that `npm run listen` is running and that the Hookdeck dashboard shows the event. Use **Actions, Send a test event** in LiveKit Cloud.
- **Deliveries rejected with 401:** the API key selected as **Signing API key** in LiveKit must match `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` in `.env`.
- **`lk` can't connect:** `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` must be set in `.env`; the script loads them.

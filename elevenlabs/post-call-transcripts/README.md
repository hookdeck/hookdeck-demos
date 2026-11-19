# ElevenLabs post-call transcripts with Hookdeck

A voice agent built on [ElevenLabs Agents](https://elevenlabs.io/agents) sends a [post-call webhook](https://elevenlabs.io/docs/eleven-agents/workflows/post-call-webhooks) when a conversation ends and its analysis is done. This demo receives those webhooks through [Hookdeck Event Gateway](https://hookdeck.com/event-gateway) and stores and shows each conversation: transcript, summary, data collection results, evaluation outcome and, optionally, the audio.

```
ElevenLabs agent ──post-call webhook──▶ Hookdeck source (ELEVENLABS) ──▶ hookdeck listen ──▶ this app (localhost:4000)
                                          │ verifies ElevenLabs-Signature
                                          │ deduplicates on type + data.conversation_id
                                          └ retries failed deliveries
```

The demo has three parts: this app, an ElevenLabs agent, and Hookdeck. It shows:

| Feature | Where to look |
|---|---|
| **Signature verification** in Event Gateway with Hookdeck's `ELEVENLABS` source type | `scripts/setup.ts` creates the source and sets the secret |
| **Deduplication** on `body.type` + `body.data.conversation_id` | the `RULES` in `scripts/setup.ts`; `npm run send -- --duplicate` |
| **Retries**: make the app fail, watch Hookdeck retry, then replay | the "Retry demo" card in the UI ("Bad line" in the Salon theme) |
| **Large payloads**: transcripts and base64 MP3 audio | the Size column in the UI; `npm run send -- --large 8` |

## Prerequisites

- Node.js 22 or later
- An [ElevenLabs](https://elevenlabs.io) account and an [ElevenLabs API key](https://elevenlabs.io/app/settings/api-keys) that can read and write agents and workspace webhooks
- A [Hookdeck](https://dashboard.hookdeck.com/signup) project, its project API key and its project signing secret (both on Project settings -> [Secrets](https://dashboard.hookdeck.com/settings/project/secrets))

## Quick start

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env` and fill in `ELEVENLABS_API_KEY`, `HOOKDECK_API_KEY` and `HOOKDECK_SIGNING_SECRET`:

   ```bash
   cp .env.example .env
   ```

   `HOOKDECK_SIGNING_SECRET` is the project signing secret from the dashboard (Project settings → [Secrets](https://dashboard.hookdeck.com/settings/project/secrets)). The API key can't read it, so copy it by hand. The app uses it to verify `x-hookdeck-signature` on every delivery.

   You don't need an agent of your own: setup creates a dedicated one and writes its ID to `.env`.

3. Set up Hookdeck and ElevenLabs:

   ```bash
   npm run setup
   ```

   The script is idempotent. It:

   - creates a Hookdeck source `elevenlabs-post-call` (type `ELEVENLABS`), a CLI destination `local-elevenlabs` (path `/webhooks/elevenlabs`) and a connection with a deduplication rule and a retry rule
   - creates an ElevenLabs workspace webhook (HMAC authentication) that points at the Hookdeck source URL, which returns the signing secret
   - sets that secret on the Hookdeck source, so Hookdeck verifies every `ElevenLabs-Signature`
   - creates (first run) or updates the agent "Hookdeck demo: post-call transcripts": a greeting, a salon booking prompt, a 10-second turn timeout, three data collection items and a `booking_made` evaluation criterion. Your other agents are not touched
   - attaches the webhook to that agent for the transcript, audio and `call_initiation_failure` events
   - writes `ELEVENLABS_WEBHOOK_URL`, `ELEVENLABS_WEBHOOK_SECRET` and `ELEVENLABS_WEBHOOK_ID` to `.env`

4. In one terminal, forward the source to the app:

   ```bash
   npm run listen
   ```

5. In another, start the app and open <http://localhost:4000>:

   ```bash
   npm start
   ```

6. Make a call. Either start a test call from the agent's page in the ElevenLabs dashboard, or hold a text-only conversation from the terminal:

   ```bash
   npm run call
   ```

   A few seconds after the call ends, the transcript appears in the app.

The app listens on `127.0.0.1` only, which is enough because `hookdeck listen` runs on the same machine. It answers `403` to a request whose `Host` header is not `localhost`, `127.0.0.1` or `[::1]`, and the page's state-changing requests carry an `x-demo` header. To reach the app from another device, set `HOST=0.0.0.0` and `ALLOWED_HOSTS=<the name or IP you browse to>` in `.env`. It keeps the 50 most recent conversations.

### Set up ElevenLabs by hand

`npm run setup` calls the ElevenLabs API for you. To do the ElevenLabs part in the dashboard, first create the Hookdeck source (type **ElevenLabs**) and a connection to a CLI destination with path `/webhooks/elevenlabs` in the Hookdeck dashboard, copy the source URL into `ELEVENLABS_WEBHOOK_URL` in `.env`, then:

1. Create a workspace webhook with HMAC authentication and the Hookdeck source URL, following the [ElevenLabs webhook documentation](https://elevenlabs.io/docs/eleven-agents/workflows/post-call-webhooks). Copy the signing secret when it is shown.
2. Paste the secret into the Hookdeck source's **Webhook Signing Secret**.
3. In the agent's **Settings**, under **Post-call webhooks**, select the webhook and choose the events.

## What you'll see

- **Data flow pane** (bottom of the page, open by default; the header collapses it): the live topology of ElevenLabs agent, Event Gateway (with its verify, store, dedup and retry capabilities), `hookdeck listen` and this app, with a packet moving along each edge as a real webhook arrives, and status badges (`answering 500`, `handled · attempt 2`, `duplicate · dropped`). The 3.5 MB audio webhook is drawn thicker and slower than the transcript. Click a node or a packet to fill the detail strip with that webhook: verified or rejected and what ElevenLabs got back, each delivery attempt's status, latency and retry gap, what the app answered, and a **View in Hookdeck** link to the request or event in the dashboard. The other tabs play four scripted scenes of the same topology with captions (Back, Next, Replay): delivery, a duplicate dropped, a bad signature, and the app down with a retry that succeeds. On a phone the pane opens at 60% of the screen height with the portrait layout, and the page keeps that much padding at the bottom so the buttons above stay reachable. It reads Event Gateway with `HOOKDECK_API_KEY` on the server.
- **Who is who**: you are the customer ringing the Hookdeck Hair booking line; the booking assistant is the agent that `npm run setup` creates (its prompt is `AGENT_CONFIG` in `scripts/setup.ts`).
- **Diary**: a week view above the conversations. A conversation whose `booking_made` evaluation is `success` fills a slot from `caller_name`, `requested_service` and `requested_time`. The page works this out from the stored conversations (`public/diary.js`); the webhook handler is unchanged. A `requested_time` it cannot read as a day and a time of day goes in an Unscheduled row as received.
- **Themes**: Salon (the default, the Hookdeck Hair booking line), Light, Dark and System, from the switch at the top right. Salon is `public/theme-salon.css` and `public/theme-salon.copy.js`; the Data flow pane keeps the standard look. Explanations sit behind the ⓘ buttons and hover tips.
- **Deliveries received** (collapsed): the latest requests the app received, with body size and result, and whether the Hookdeck signature check passed.

Data collection results and evaluation criteria are configured per agent (agent -> **Analysis**). Setup gives the demo agent `caller_name`, `requested_service` and `requested_time` as data collection items and `booking_made` as an evaluation criterion; they show up in the conversation detail.

## Deduplication

ElevenLabs sends three kinds of events with the same `data.conversation_id`: `post_call_transcription`, `post_call_audio` and `call_initiation_failure`. Deduplicating on `conversation_id` alone would drop the audio event after the transcription arrived, so the rule keys on `body.type` and `body.data.conversation_id`:

```json
{ "type": "deduplicate", "window": 3600000, "include_fields": ["body.type", "body.data.conversation_id"] }
```

The rule uses specific fields because a re-delivery carries a new `ElevenLabs-Signature` timestamp and signature, so comparing the whole request would see it as different. The window is the longest Hookdeck allows, one hour.

To see it work without a call:

```bash
npm run send -- --duplicate
```

This sends the same signed transcription twice. Hookdeck accepts both requests, delivers one event and ignores the other. The app also records each `type:conversation_id` it has processed and answers a repeat with `200 duplicate`, so a duplicate that outlives the dedup window (or arrives on a replay) is still stored once.

## Retries and replay

1. In the UI, under **Retry demo**, set **Fail the next** to `1` deliveries and click **Apply**.
2. Make a call (or run `npm run send`).
3. The first delivery attempt gets a `500`. In the Hookdeck dashboard the event shows a failed attempt, and Hookdeck retries it on the connection's retry rule (linear, every 10 seconds, up to 5 times). The next attempt succeeds and the conversation appears.
4. Fail more attempts than the retry rule allows, then open the event in the Hookdeck dashboard and click **Retry** to replay it.

Each attempt shows up in the deliveries table, so you can see the failure and the retry side by side.

## Large payloads

A `post_call_transcription` payload grows with the transcript, the analysis and the dynamic variables. A `post_call_audio` payload carries the whole call as a base64 MP3 inside JSON, so it is the large one. The app accepts bodies up to 100 MB, and the deliveries table shows the size of every request. Hookdeck accepts requests up to your organization's [maximum payload size](https://hookdeck.com/docs/limits).

`npm run send -- --large 8` sends a transcription padded to about 8 MB so you can see how a large body flows through the source, `hookdeck listen` and the app.

## Verifying the signature

Two signatures are in play, and each is checked once:

- **`ElevenLabs-Signature`** is verified by Event Gateway at the source URL, so the app does not check it. Hookdeck forwards the original headers and body, so the header still reaches the app.
- **`x-hookdeck-signature`** is verified by the app on every delivery, before it does anything else. It is the base64 HMAC-SHA256 of the raw request body, keyed with `HOOKDECK_SIGNING_SECRET` (`src/hookdeck-signature.ts`, synced from `_shared`). A delivery with a missing or wrong signature gets a `401` and shows in **Deliveries received** as `signature_rejected`, with a red **Hookdeck signature rejected** badge.

Hookdeck's signature has no timestamp. Event Gateway verified ElevenLabs' signature when it accepted the request, so a retry or a replay hours later is legitimate and still passes.

## Topology scenes, and MP4s of them

The topology is a scene from the shared scene kit (`_shared/scenes/` in the repo, synced into `scenes/kit/`; this demo's scenes are `scenes/post-call.ts`). One scene definition gives three outputs: the live view in the Data flow pane at the bottom of the page, the four scripted scenes (a 1920x1080 layout and a portrait layout for phones, with the same steps and captions, which the hookdeck.com `steppedDiagram` component can embed), and captures.

```bash
npm run build:scenes                       # bundle the kit and scenes into public/scenes (npm start does this)
npm run capture                            # MP4 of each scripted scene, 1920x1080, into scenes/captures
ASPECT=square npm run capture              # 1080x1080 for social: phone layout and a large numbered caption
THEME=dark npm run capture -- delivery
```

The capture script seeks each scene's timeline frame by frame in headless Chromium, so frames are exact. The output is MP4 only: social platforms take MP4 and convert GIFs themselves, and guides use the interactive diagrams. It needs `ffmpeg`, and Playwright's Chromium (`npx playwright install chromium`) or Google Chrome. The kit's README (`_shared/scenes/README.md`) explains how to write a scene for another demo.

## Tests

```bash
npm test
```

The tests post signed sample payloads (generated in `src/samples.ts`) to the app and check that conversations are stored, merged, deduplicated and acknowledged, that the failure toggle returns a `500` and then recovers, and that the signature header matches the format the ElevenLabs SDK verifies.

## Project structure

```
elevenlabs/post-call-transcripts/
├── .env.example
├── package.json
├── scripts/
│   ├── setup.ts          # Hookdeck source, destination, connection, rules + ElevenLabs webhook and agent
│   ├── listen.ts         # hookdeck listen for the source
│   ├── call.ts           # text-only conversation with the agent
│   ├── send-sample.ts    # signed sample payloads, duplicates, large bodies
│   ├── probe.ts          # checks that a good signature is accepted and a bad one rejected
│   ├── hookdeck-api.ts   # calls the Hookdeck API with HOOKDECK_API_KEY (synced from _shared)
│   └── hookdeck-cli.ts   # runs the Hookdeck CLI for npm run listen (synced from _shared)
├── scenes/
│   ├── post-call.ts      # the topology scene: live, and four scripted scenarios (desktop + phone)
│   ├── entry.ts          # what the page's bundle exposes
│   ├── kit/              # shared scene kit, synced from _shared/scenes (don't edit)
│   └── captures/         # MP4s from npm run capture (landscape + square, light)
├── src/
│   ├── server.ts         # Express app and API
│   ├── webhook.ts        # POST /webhooks/elevenlabs
│   ├── hookdeck-signature.ts # verifies x-hookdeck-signature (synced from _shared)
│   ├── store.ts          # JSON-file storage, idempotency, audio files
│   ├── events.ts         # event and record types
│   └── samples.ts        # sample payloads and signer
├── public/               # UI
└── test/
```

## Troubleshooting

- **No webhook arrives**: check that `npm run listen` is running and that the agent's **Post-call webhooks** setting selects the webhook. The Hookdeck dashboard shows the request under the `elevenlabs-post-call` source.
- **A request is rejected with `VERIFICATION_FAILED`**: the signing secret on the Hookdeck source doesn't match the ElevenLabs webhook's. Run `npm run setup` again after deleting the webhook in ElevenLabs, or paste the correct secret into the source.

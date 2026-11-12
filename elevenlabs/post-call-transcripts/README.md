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
| **Signature verification** at the edge with Hookdeck's `ELEVENLABS` source type | `scripts/setup.ts` creates the source and sets the secret |
| **Deduplication** on `body.type` + `body.data.conversation_id` | the `RULES` in `scripts/setup.ts`; `npm run send -- --duplicate` |
| **Retries**: make the app fail, watch Hookdeck retry, then replay | the "Retry demo" card in the UI |
| **Large payloads**: transcripts and base64 MP3 audio | the Size column in the UI; `npm run send -- --large 8` |

## Prerequisites

- Node.js 22 or later
- An [ElevenLabs](https://elevenlabs.io) account and an [ElevenLabs API key](https://elevenlabs.io/app/settings/api-keys) that can read and write agents and workspace webhooks
- A [Hookdeck](https://dashboard.hookdeck.com/signup) project and a project API key (Project settings -> API keys)

## Quick start

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env` and fill in `ELEVENLABS_API_KEY` and `HOOKDECK_API_KEY`:

   ```bash
   cp .env.example .env
   ```

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

   `npm run call` needs the agent to allow the text-only override (agent -> Security -> Overrides). A few seconds after the call ends, the transcript appears in the app.

### Set up ElevenLabs by hand

`npm run setup` calls the ElevenLabs API for you. To do the ElevenLabs part in the dashboard, first create the Hookdeck source (type **ElevenLabs**) and a connection to a CLI destination with path `/webhooks/elevenlabs` in the Hookdeck dashboard, copy the source URL into `ELEVENLABS_WEBHOOK_URL` in `.env`, then:

1. Create a workspace webhook with HMAC authentication and the Hookdeck source URL, following the [ElevenLabs webhook documentation](https://elevenlabs.io/docs/eleven-agents/workflows/post-call-webhooks). Copy the signing secret when it is shown.
2. Paste the secret into the Hookdeck source's **Webhook Signing Secret**.
3. In the agent's **Settings**, under **Post-call webhooks**, select the webhook and choose the events.

## What you'll see

- **Conversations**: each stored conversation with its summary, outcome badge (`call_successful`), transcript, data collection results and evaluation criteria. If the audio event is enabled, an audio player appears when it arrives.
- **Data flow** (the drawer at the bottom of the page): each webhook moving from ElevenLabs through Event Gateway (request, verification, event) to this app, with every delivery attempt, including failed ones and their retries, and what the app answered. It reads Event Gateway with `HOOKDECK_API_KEY` on the server.
- **Deliveries received** (collapsed): the latest requests the app received, with body size and result, and the result of the ElevenLabs SDK's `constructEvent` on the forwarded requests.

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

Hookdeck verifies `ElevenLabs-Signature` at the source URL, so the app does not have to. Hookdeck forwards the original headers and the original body, so the signature header still reaches the app. When `ELEVENLABS_WEBHOOK_SECRET` is set, the app runs `elevenlabs.webhooks.constructEvent` from [`@elevenlabs/elevenlabs-js`](https://www.npmjs.com/package/@elevenlabs/elevenlabs-js) on each forwarded request and shows the result in the **SDK check** column. It does not block anything.

The SDK rejects a timestamp older than 30 minutes, so a replay of an old event shows a tolerance error in that column while the event is still stored.

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
│   └── hookdeck-cli.ts   # runs the Hookdeck CLI against HOOKDECK_API_KEY's project
├── src/
│   ├── server.ts         # Express app and API
│   ├── webhook.ts        # POST /webhooks/elevenlabs
│   ├── store.ts          # JSON-file storage, idempotency, audio files
│   ├── events.ts         # event and record types
│   └── samples.ts        # sample payloads and signer
├── public/               # UI
└── test/
```

## Troubleshooting

- **No webhook arrives**: check that `npm run listen` is running and that the agent's **Post-call webhooks** setting selects the webhook. The Hookdeck dashboard shows the request under the `elevenlabs-post-call` source.
- **A request is rejected with `VERIFICATION_FAILED`**: the signing secret on the Hookdeck source doesn't match the ElevenLabs webhook's. Run `npm run setup` again after deleting the webhook in ElevenLabs, or paste the correct secret into the source.
- **`npm run call` closes immediately**: the agent doesn't allow the text-only override. Start a test call from the dashboard instead.

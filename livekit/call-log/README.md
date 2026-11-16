# LiveKit story night with Hookdeck

A short spoken adventure for one or more players, told by AI characters, with everything that happens in the room reported back as webhooks. Players join a LiveKit room from the page. Hester Pennywhistle, the innkeeper of the Drowned Bell, asks each player's name and writes it in her ledger, then fetches Old Bram Tallow, a retired lighthouse keeper who tells a four-scene story. Both characters are fictional. At each scene the app pulls a soundtrack into the room with LiveKit's Ingress API. LiveKit Cloud sends the room, participant, track and ingress events to a Hookdeck source, Hookdeck delivers them to this app, and the app builds a call log and a session chronicle from them.

```
players ──► LiveKit room ◄── agent (Hester, then Old Bram) ──► this app: POST /api/scene
               │                                                      │ Ingress API: soundtrack
               └──webhooks──► Hookdeck source ──► hookdeck listen ──► this app (:4000)
```

The demo has three parts: this app (and its agent), LiveKit Cloud and Hookdeck Event Gateway. The agent uses LiveKit Inference for speech-to-text, the language model and text-to-speech, so the only credentials are your LiveKit project's API key and secret.

## What it shows

- **Raw-body verification.** LiveKit signs each webhook with a JWT in the `Authorization` header, and the JWT includes a SHA-256 hash of the body. The app verifies it with `WebhookReceiver` from `livekit-server-sdk` on the raw body (`application/webhook+json` is not parsed by `express.json()`).
- **Idempotent call log.** Each event is applied as a set-this-field update keyed by the room session id, so a duplicate delivery, a retry or an event that arrives out of order leaves the log correct. See [`src/call-log.ts`](src/call-log.ts).
- **Delivery list.** The page lists every request the app received and whether it was applied, a duplicate or rejected.
- **Join a call from the page.** A **Join a call** button connects your browser to a LiveKit room with `livekit-client` and your microphone, using a short-lived token the server mints (`POST /api/token`). The API secret stays on the server. The token's room configuration dispatches the agent by name (`story-gm`), so only rooms joined from this page get the story agent.
- **A soundtrack per scene.** At each new scene Old Bram calls a function tool. The tool posts to the app (`POST /api/scene`, local only), and the app asks LiveKit's Ingress API to pull that scene's soundtrack from a URL into the room. LiveKit reports `ingress_started`, `ingress_ended` and the track events back through Event Gateway.
- **A session chronicle.** The page builds a timeline of the session from the webhooks it receives: who joined and when, who dropped (`participant_connection_aborted`), each scene's soundtrack starting and ending, and the session length. It tells players, the story agent and soundtracks apart with `participant.kind` in the payload (`AGENT` for the agent, `INGRESS` for a soundtrack, absent for a player). See [`src/chronicle.ts`](src/chronicle.ts).
- **Event Gateway rules.** The connection deduplicates on the LiveKit event id (`body.id`, 10 minutes) and retries failed deliveries with exponential backoff (8 attempts from 30 seconds).
- **A data flow pane.** The page's bottom pane shows each webhook travelling from LiveKit Cloud through Event Gateway and `hookdeck listen` to the app, with scripted scenes for a call's lifecycle, a duplicate, a bad signature and an app that is down.

## Quick start

After [setup](#setup) (about five minutes, once), run three things in three terminals:

```bash
npm run listen   # Hookdeck forwards the webhooks to the app
npm start        # the app
npm run agent    # Hester and Old Bram (installs agent/ on first run)
```

1. Open <http://localhost:4000> (or the `PORT` in `.env`).
2. Enter a name if you like (Hester then greets you by it and doesn't ask), select **Join a call** and allow the microphone. If you typed a name, Hester greets you by it, otherwise she asks for your first name. Then she says she will fetch Old Bram, who tells the story.
3. To play with friends, open the page in a second tab or on another machine and select **Join a call** there. To play alone with company, select **Add Pixel, a mute player**: Pixel is a scripted traveller who cannot speak. When Old Bram gives Pixel the turn, it sends one short gesture line (for example "*Pixel holds the lantern up to the cave wall and taps a carving.*") as a chat message, which appears in the Transcript, and Old Bram weaves it into the story. Pixel uses no language model of its own.
4. Play: Old Bram sets four scenes and gives each player a turn. The agent hears one player at a time, so wait until the page says **Your turn**. The page shows the **Transcript** (what the characters and players say), who the turn belongs to, and which soundtrack is playing.
5. When Old Bram closes the story, the page says **The story has ended** and offers **Start a new story**. Select **Leave** any time to stop earlier. The **Session chronicle**, the call log and the **Data flow** pane fill in as the webhooks arrive. A session ends, and its chronicle closes, about a minute after the last person leaves, because LiveKit closes an empty room after its departure timeout.

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

`npm run setup` creates the webhook for you when you are signed in to LiveKit Cloud with the LiveKit CLI. It uses LiveKit Cloud's management API (on LiveKit's `beta-api` host), which takes your user sign-in rather than an API key and secret:

```bash
lk cloud auth --user-auth   # opens a browser sign-in once
npm run setup               # also creates (or updates) the "Hookdeck: livekit-call-log" webhook
```

Setup finds your project by matching `LIVEKIT_URL` (set `LIVEKIT_PROJECT_ID` to choose one), signs the webhook with `LIVEKIT_API_KEY`, and updates the webhook instead of duplicating it when you run it again. To use a session token yourself, set `LIVEKIT_SESSION_TOKEN`.

If you are not signed in, setup still creates the Hookdeck connection and prints these steps. In the LiveKit Cloud dashboard open **Settings, Webhooks** and select **Create new webhook**. Enter a name, paste the `LIVEKIT_WEBHOOK_URL` value as the URL, choose your API key as the **Signing API key**, and select **Create**. Use **Actions, Send a test event** to check the path.

See LiveKit's [webhooks documentation](https://docs.livekit.io/intro/basics/rooms-participants-tracks/webhooks-events/) for the events and payloads.

### 5. Run it

In two terminals:

```bash
npm run listen   # hookdeck listen: forwards the source to localhost:4000
npm start        # the app
```

Open <http://localhost:4000>.

## The story and the agent

`npm run agent` starts a worker (`agent/src/main.ts`, built with [`@livekit/agents`](https://docs.livekit.io/agents/) for Node.js) that registers with your LiveKit project as `story-gm`. It needs Node.js 22.18 or later. The page's token dispatches it when the first player joins, so there is nothing to configure in the LiveKit dashboard.

| Character | Role | Manner | Voice (LiveKit Inference) |
|---|---|---|---|
| **Hester Pennywhistle** | Innkeeper of the Drowned Bell. Greets travellers by the name they typed on the page, or asks for a first name when there is none, writes each in the ledger (`write_in_ledger`), then announces that she is fetching Old Bram and hands over (`fetch_bram`, an `llm.handoff`). | Brisk, warm, a little nosy, dry humour, calls everyone "love" or "dear". | Cartesia Sonic 3, voice `f31cc6a7-c1e8-4764-980c-60a361443dd1` (Robyn, an Australian, mature voice from LiveKit's documented list) |
| **Old Bram Tallow** | Retired lighthouse keeper who tells "The Lantern of Hollow Mere". Calls `next_scene` to start each scene's soundtrack, `give_turn` to listen to one player at a time, and `end_story` after his closing. | Slow, gravelly, kind, sea-worn turns of phrase, loves a pause. | Deepgram Aura 2, voice `draco` (a British male voice) |

Hester and Bram are one agent participant in the room. The agent publishes what the page shows as participant attributes on itself: `story.character`, `story.turn`, `story.turn_name` and `story.turn_seq` (whose turn it is), `story.scene` and `story.state` (`ended` when the story is over). Bram's `give_turn` tool rotates through different ways to hand a turn over (an open question, two choices, a vivid detail with no question, an invitation to speak, a short challenge) so he does not end every reply the same way.

Speech-to-text (Deepgram Nova 3), the language model (OpenAI GPT-4.1 mini) and text-to-speech all run on [LiveKit Inference](https://docs.livekit.io/agents/models/) billed to your LiveKit project, so the only credentials are your LiveKit key and secret.

The agent logs `LLM: LiveKit Inference openai/gpt-4.1-mini` at startup. Inference usage beyond your plan's included credits is billed to your LiveKit project, so keep test runs short.

**Pixel**, the mute player, is a small Node participant (`agent/src/pixel.ts`, `@livekit/rtc-node`) that the app starts when you select **Add Pixel**. It joins as `bot-pixel`, publishes no media, and when `story.turn` is its identity (and the storyteller is listening) it waits one to three seconds and sends one scripted gesture line on the `lk.chat` topic, which an agent session accepts as text input. It needs no LiveKit CLI. Its webhooks are `participant_joined` and `participant_left` as a standard participant, so the chronicle lists it as a player.
 The agent calls the app at `http://localhost:4000` (set `STORY_APP_URL` if the app runs elsewhere). The story runs about six minutes, and the page's **Transcript** shows what is said, from the `lk.transcription` text streams the agent publishes.

## Soundtracks

The four 3 minute soundtracks in `public/soundtracks/` (`tavern.ogg`, `forest.ogg`, `cave.ogg`, `finale.ogg`) are generated by [`scripts/make-soundtracks.sh`](scripts/make-soundtracks.sh) with ffmpeg from synthesized tones and filtered noise, kept quiet so the storyteller stays audible. A soundtrack plays until the next scene replaces it, so each is longer than a scene usually runs. The page shows **Now playing** while one is in the room. They contain no one else's audio, so there is nothing to license. Run the script to change them.

LiveKit Cloud fetches the file itself, so the URL must be public: `localhost` doesn't work. By default the app points at this folder in the repository (`raw.githubusercontent.com/hookdeck/hookdeck-demos/main/livekit/call-log/public/soundtracks/<scene>.ogg`). To host the files yourself, set `SOUNDTRACK_BASE_URL` in `.env`, or `SOUNDTRACK_URL_TAVERN` (and `_FOREST`, `_CAVE`, `_FINALE`) for one scene. If a soundtrack can't be fetched, the story carries on without music. Each scene's ingress is deleted when the next scene starts, when the story ends and when the room finishes (the `room_finished` webhook), and the app deletes leftover `scene:*` ingresses from rooms that are gone when it starts, so nothing counts against your project's ingress limit.

## The data flow pane

The page has a **Data flow** pane at the bottom, open by default. **Live** shows the demo as it runs: each webhook travels from LiveKit Cloud through Event Gateway (receive, store, dedup, retry) and `hookdeck listen` to the app. Click a node or a packet for that webhook's details below the diagram: each delivery attempt, what the app answered and a **View in Hookdeck** link. When Old Bram starts a scene, a packet travels from the app to LiveKit's Ingress API along the outbound **INGRESS** edge, and the ingress webhooks come back through Event Gateway. The other tabs play scripted scenes with captions: **Call lifecycle**, **Duplicate dropped**, **Bad signature** and **App down, retry succeeds**.

The scenes live in `scenes/livekit-calls.ts` (the kit in `scenes/kit/` is synced from `_shared/scenes`). MP4 captures of the four scenes, landscape and square, are in `scenes/captures/`. To render them again: `npm run capture -- livekit-call-lifecycle`.

## Generate activity from the command line (optional)

The **Join a call** button is the way to try the demo. To generate a call without a browser or the agent, install the [LiveKit CLI](https://docs.livekit.io/home/cli/) (`brew install livekit-cli`), then:

```bash
npm run activity
```

This path needs no browser. The script creates a room, joins two test participants with demo media, and lets them leave. The call log shows the room appear, the participants join and leave, and the room finish. Pass a room name and a duration in seconds: `npm run activity -- standup 30`.

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
├── agent/                   # `npm run agent`: Hester and Old Bram
├── scenes/
│   ├── livekit-calls.ts     # The topology: live scene and four scripted scenes
│   ├── entry.ts             # What the page's bundle exposes
│   ├── captures/            # MP4s, landscape and square
│   └── kit/                 # Synced from _shared/scenes
├── scripts/
│   ├── make-soundtracks.sh  # Generates public/soundtracks/*.ogg with ffmpeg
│   ├── activity.sh          # Creates a room and joins test participants with the lk CLI
│   ├── simulate.ts          # Sends signed events (or a bad signature, or a duplicate) to the source
│   ├── livekit-cloud.ts     # Creates the LiveKit Cloud webhook through the management API
│   ├── hookdeck-cli.ts      # Synced from _shared: runs the Hookdeck CLI against the API key's project
│   ├── listen.ts            # npm run listen
│   └── setup-hookdeck.ts    # npm run setup
├── src/
│   ├── token.ts             # Mints the short-lived browser token and dispatches the agent
│   ├── chronicle.ts         # Builds the session chronicle from webhooks
│   ├── soundtracks.ts       # Scene names and soundtrack URLs
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

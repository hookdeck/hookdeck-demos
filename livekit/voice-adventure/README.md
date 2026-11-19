# LiveKit story night with Hookdeck

## The use case

A backend that needs a reliable record of what happens in LiveKit rooms: who joined, who dropped, which tracks were published, when an ingress or egress started and ended, and how long the session ran. LiveKit reports all of it as webhooks. This demo builds that record from the room webhooks, delivered through [Hookdeck Event Gateway](https://hookdeck.com/event-gateway): the app verifies each webhook's signed token, Event Gateway deduplicates repeats on the event `id` and retries deliveries when the app fails, and every event can be replayed.

## The scenario: story night

To give every room event a visible purpose, the demo is a multiplayer voice adventure. Players join a LiveKit room from the page. Two LiveKit agents run the evening: Hester Pennywhistle, the innkeeper of the Drowned Bell, writes each name in her ledger and fetches Old Bram Tallow, a retired lighthouse keeper who tells a four-scene story. A mute bot player, Pixel, takes part with gestures. At each scene the app pulls a soundtrack into the room with LiveKit's Ingress API, so ingress events appear in the record too. The **session chronicle** on the page is the backend record: a timeline built only from the webhooks the app receives, and the call log beside it keeps one entry per room session. Both characters are fictional.

```
players ──► LiveKit room ◄── agent (Hester, then Old Bram) ──► this app: POST /api/scene
               │                                                      │ Ingress API: soundtrack
               └──webhooks──► Hookdeck source ──► hookdeck listen ──► this app (:4000)
```

The demo has three parts: this app (and its agent), LiveKit Cloud and Hookdeck Event Gateway. The agent uses LiveKit Inference for speech-to-text, the language model and text-to-speech, so the only credentials are your LiveKit key and secret (plus a Hookdeck project API key).

## Quick start

After [setup](#setup) (about five minutes, once), run three things in three terminals:

```bash
npm run listen   # Hookdeck forwards the webhooks to the app
npm start        # the app
npm run agent    # Hester and Old Bram (installs agent/ on first run)
```

1. Open <http://localhost:4000> (or the `PORT` in `.env`).
2. Enter a name if you like (Hester then greets you by it and doesn't ask), select **Join a call** and allow the microphone. If you typed a name, Hester greets you by it, otherwise she asks for your first name. Then she says she will fetch Old Bram, who tells the story.
3. To play with friends, copy the **invite link** the page shows once you have joined and send it, or open it in a second tab. The link is this page's address with `?room=story-...`; opening it and selecting **Join a call** puts you in the same story. The app only joins a room it created and that is still open, so an old or made-up link says the story is not open. Each person needs their own microphone (the agent hears one player at a time). To play alone with company, select **Add Pixel, a mute player**: Pixel is a scripted traveller who cannot speak. It answers when you speak to it, and once when the party arrives somewhere new, with one short gesture line (for example "*Pixel holds the lantern up to the cave wall and taps a carving.*") that appears in the Transcript. Pixel never holds a turn and nothing waits for it. Pixel uses no language model of its own.
4. Play: the goal is to relight Old Bram's lighthouse with the Lantern of Hollow Mere. The party moves between five places (the inn, the Hollow Wood, the hollow oak, the cave under the Mere, the lighthouse), takes items into one shared satchel (a map, a small brass key, the Lantern, flint and a wick) and opens the iron chest in the inn with the key. Bram says what you see, hear and notice and never tells you what to do. The story ends when the Lantern is lit at the lighthouse.
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
| `HOOKDECK_API_KEY` | Hookdeck dashboard, Project settings, [Secrets](https://dashboard.hookdeck.com/settings/project/secrets) |
| `HOOKDECK_SIGNING_SECRET` | The same page. The API key can't read it, so copy it by hand. The app verifies `x-hookdeck-signature` on every delivery with it |

### 3. Create the Hookdeck connection

```bash
npm run setup
```

This creates a `livekit-voice-adventure` source of type `LIVEKIT` (Event Gateway verifies each LiveKit token with `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`, and rejects a forged request before it reaches the app), a CLI destination that forwards to `/webhooks/livekit`, and the connection between them with a deduplicate rule and a retry rule. It writes the source URL to `LIVEKIT_WEBHOOK_URL` in `.env`. The script is idempotent. It calls the Hookdeck API with `HOOKDECK_API_KEY`, so your interactive `hookdeck login` is untouched.

### 4. Add the webhook in LiveKit Cloud

`npm run setup` creates the webhook for you when you are signed in to LiveKit Cloud with the LiveKit CLI. It uses LiveKit Cloud's management API (on LiveKit's `beta-api` host), which takes your user sign-in rather than an API key and secret:

```bash
lk cloud auth --user-auth   # opens a browser sign-in once
npm run setup               # also creates (or updates) the "Hookdeck: livekit-voice-adventure" webhook
```

**Renamed from "call log".** This demo used to be `livekit/call-log`, with a `livekit-call-log` source and connection, a `local-livekit-call-log` destination and a LiveKit Cloud webhook named "Hookdeck: livekit-call-log". `npm run setup` now creates the `livekit-voice-adventure` resources and moves an existing "Hookdeck: livekit-call-log" webhook to the new source URL instead of adding a second one. The old Hookdeck source, connection and destination are safe to delete in the dashboard.

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

## How it works

- **Two checks, each done once.** LiveKit signs each webhook with a JWT in the `Authorization` header, and the JWT includes a SHA-256 hash of the body. Event Gateway verifies it at the `LIVEKIT` source with your API key and secret, so a forged request gets a 200, is recorded as `VERIFICATION_FAILED` and creates no event. The app verifies Hookdeck's `x-hookdeck-signature` (the base64 HMAC-SHA256 of the raw body, keyed with `HOOKDECK_SIGNING_SECRET`; `src/hookdeck-signature.ts`) on every delivery, before it does anything else, and answers 401 when it is missing or wrong. A rejected delivery shows in the delivery list as `rejected` and in the pane as `returned 401`. The app reads the body raw (`application/webhook+json` is not parsed by `express.json()`) so the signature covers the exact bytes.
- **Retries after 5 minutes.** LiveKit's token expires 5 minutes after it issues it, and Event Gateway forwards the original `Authorization` header on every retry. The app doesn't check that token, so a retry after 5 minutes works. Hookdeck's signature has no timestamp, so a retry or a replay hours later also passes.
- **Idempotent room record.** Each event is applied as a set-this-field update keyed by the room session id, so a duplicate delivery, a retry or an event that arrives out of order leaves the log correct. See [`src/call-log.ts`](src/call-log.ts).
- **Delivery list.** The page lists every request the app received and whether it was applied, a duplicate or rejected.
- **Join a call from the page.** A **Join a call** button connects your browser to a LiveKit room with `livekit-client` and your microphone, using a short-lived token the server mints (`POST /api/token`). The API secret stays on the server. The token's room configuration dispatches the agent by name (`story-gm`), so only rooms joined from this page get the story agent.
- **A soundtrack per place.** When the party moves to a place whose soundtrack differs from the one playing, the agent posts to the app (`POST /api/scene`, with a secret header derived from your API secret, so only the agent can call it), and the app checks the file with a HEAD request and then pulls it into the room with the Ingress API (a URL input). A file that can't be fetched means no music, and Old Bram is not told there is any. The files last 180 seconds, so when a scene's ingress ends (the `ingress_ended` webhook) the app starts the same soundtrack again while the story is still in that scene. The hollow oak keeps the forest soundtrack. The room then shows an ingress participant and `ingress_started` and `ingress_ended` webhooks arrive through Event Gateway like every other event.
- **A session chronicle.** The page builds a timeline of the session from the webhooks it receives: who joined and when, who dropped (`participant_connection_aborted`), each scene's soundtrack starting and ending, and the session length. It tells players, the story agent and soundtracks apart with `participant.kind` in the payload (`AGENT` for the agent, `INGRESS` for a soundtrack, absent for a player). See [`src/chronicle.ts`](src/chronicle.ts).
- **Event Gateway rules.** The connection deduplicates on the LiveKit event id (`body.id`, 10 minutes) and retries failed deliveries with exponential backoff (8 attempts from 30 seconds).
- **A data flow pane.** The page's bottom pane shows each webhook travelling from LiveKit Cloud through Event Gateway and `hookdeck listen` to the app, with scripted scenes for a call's lifecycle, a duplicate, a bad signature and an app that is down.

## The story and the agent

`npm run agent` starts a worker (`agent/src/main.ts`, built with [`@livekit/agents`](https://docs.livekit.io/agents/) for Node.js) that registers with your LiveKit project as `story-gm`. It needs Node.js 22.18 or later. The page's token dispatches it when the first player joins, so there is nothing to configure in the LiveKit dashboard.

| Character | Role | Manner | Voice (LiveKit Inference) |
|---|---|---|---|
| **Hester Pennywhistle** | Innkeeper of the Drowned Bell. Greets travellers by the name they typed on the page, or asks for a first name when there is none, writes each in the ledger (`write_in_ledger`), then announces in her own voice that she is fetching Old Bram and hands over. The announcement and the handoff are code (`session.say`, then `session.updateAgent`), not a model call, so they cannot be skipped. | Brisk, warm, a little nosy, dry humour, calls everyone "love" or "dear". | Cartesia Sonic 3, voice `f31cc6a7-c1e8-4764-980c-60a361443dd1` (Robyn, an Australian, mature voice from LiveKit's documented list) |
| **Old Bram Tallow** | Retired lighthouse keeper who tells "The Lantern of Hollow Mere". He has no tools: the code decides what happens and he narrates it. |

Hester and Bram are one agent participant in the room. The agent publishes what the page shows as participant attributes on itself: `story.character`, `story.turn`, `story.turn_name` and `story.turn_seq` (whose turn it is), `story.scene` and `story.state` (`ended` when the story is over). Turns are code, not a model tool: Old Bram ends each reply by naming the player who answers next, and when his speech has finished playing the agent links that player (or the next in rotation) and sets `story.turn`. Only real player input counts toward a scene (a final transcript from the linked player), `next_scene` is allowed only in the reply that answers a player who clearly chose to move on (never chained after another call, and never to push the group on: there is no minimum number of exchanges and no nudge), and a filter drops any tool name from speech before text-to-speech.

Speech-to-text (Deepgram Nova 3), the language model (OpenAI GPT-4.1 mini) and text-to-speech all run on [LiveKit Inference](https://docs.livekit.io/agents/models/) billed to your LiveKit project, so the only credentials are your LiveKit key and secret.

The agent logs `LLM: LiveKit Inference openai/gpt-4.1-mini` at startup. Inference usage beyond your plan's included credits is billed to your LiveKit project, so keep test runs short.

**Pixel**, the mute player, is a small Node participant (`agent/src/pixel.ts`, `@livekit/rtc-node`) that the app starts when you select **Add Pixel** (at most `MAX_PIXELS`, default 4, at a time). It joins as `bot-pixel`, publishes no media, and sends the gesture lines the story agent hands it on the `lk.chat` topic, which the page shows in the Transcript. Those chat messages do not reach the agent: an agent session accepts text only from the participant it is linked to, and Pixel is never linked, because it never holds a turn. Old Bram reacts through the agent's own notes instead. The agent chooses the line (for the place and the satchel), publishes it as the `story.pixel_line` and `story.pixel_seq` attributes, remembers what Pixel did, and tells Bram to weave it into his next reply. Pixel logs to `data/pixel.log`. Its webhooks are `participant_joined` and `participant_left` as a standard participant, so the chronicle lists it as a player.

The agent calls the app at `http://localhost:4000` (set `STORY_APP_URL` if the app runs elsewhere). The story runs about six minutes, and the page's **Transcript** shows what is said, from the `lk.transcription` text streams the agent publishes.

## Soundtracks

The four 3 minute soundtracks in `public/soundtracks/` are real ambience recordings that fit the scenes: cafe chatter for the tavern, a woodland morning chorus for the forest, a dripping cave, and wind and rigging in a harbour for the finale (Old Bram is a retired lighthouse keeper). They are public-domain or CC0 field recordings, trimmed to 3 minutes, loudness-normalized to a quiet level so the storyteller stays audible, and encoded as Ogg Vorbis. Sources, authors and licences are in [`public/soundtracks/CREDITS.md`](public/soundtracks/CREDITS.md), and [`scripts/make-soundtracks.sh`](scripts/make-soundtracks.sh) rebuilds them with ffmpeg. A soundtrack plays until the next scene replaces it, so each is longer than a scene usually runs. The page shows **Now playing** while one is in the room.

LiveKit Cloud fetches the file itself, so the URL must be public: `localhost` doesn't work. By default the app points at this folder in the repository (`raw.githubusercontent.com/hookdeck/hookdeck-demos/main/livekit/voice-adventure/public/soundtracks/<scene>.ogg`). To host the files yourself, set `SOUNDTRACK_BASE_URL` in `.env`, or `SOUNDTRACK_URL_TAVERN` (and `_FOREST`, `_CAVE`, `_FINALE`) for one scene. If a soundtrack can't be fetched, the story carries on without music. Each scene's ingress is deleted when the next scene starts, when the story ends and when the room finishes (the `room_finished` webhook), and the app deletes leftover `scene:*` ingresses from rooms that are gone when it starts, so nothing counts against your project's ingress limit.

## The webhooks it produces

Observed on LiveKit Cloud with a 20 second call (two participants), a `LIVEKIT` source type, with the app verifying Hookdeck's signature on each delivery:

| Event | Count | Body size |
|---|---|---|
| `room_started` | 1 | 457 bytes |
| `participant_joined` | 2 (plus the agent and each soundtrack) | about 760 bytes |
| `track_published`, `track_unpublished` | 2 each | 1.0 to 1.1 KB |
| `participant_left` | 2 | about 860 bytes |
| `room_finished` | 1 | 152 bytes |
| `ingress_started`, `ingress_ended` | 1 each per soundtrack | about 0.6 KB |

- **Ordering and timing.** Events arrived in the order LiveKit generated them. `room_finished` came about 38 seconds after the last participant left (the room's departure timeout), so a record must not assume a call ends as soon as the last person leaves.
- **Signature.** The `Authorization` header is a JWT (HS256) whose `iss` claim is the signing key, whose `sha256` claim is the base64 SHA-256 of the body, and which expires five minutes after LiveKit issues it. Event Gateway stores the request and forwards the header and the body unchanged; the body it stored and the body the app received were identical.
- **Who is who.** `participant.kind` is absent for a player, `AGENT` for the story agent, and `INGRESS` for a soundtrack. `track_published` and `track_unpublished` events carry no `kind`, so the chronicle reads participant events. A second `participant_joined` of kind `AGENT` in the same room means LiveKit restarted the storyteller; the chronicle notes it.
- **Dedup and retries.** Sending the same event id twice produces one delivery (the second request is recorded with `ignored_count: 1` and no event). An app that answers 503 or 401 gets retried: the first retry about 30 seconds later, then exponential backoff for up to 8 attempts.

## The data flow pane

The page has a **Data flow** pane at the bottom, open by default. **Live** shows the demo as it runs: each webhook travels from LiveKit Cloud through Event Gateway (receive, store, dedup, retry) and `hookdeck listen` to the app. Click a node or a packet for that webhook's details below the diagram: each delivery attempt, what the app answered and a **View in Hookdeck** link. When Old Bram starts a scene, a packet travels from the app to LiveKit's Ingress API along the outbound **INGRESS** edge, and the ingress webhooks come back through Event Gateway. The other tabs play scripted scenes with captions: **Call lifecycle**, **Duplicate dropped**, **Bad signature** and **App down, retry succeeds**.

The scenes live in `scenes/livekit-calls.ts` (the kit in `scenes/kit/` is synced from `_shared/scenes`). MP4 captures of the four scenes, landscape and square, are in `scenes/captures/`. To render them again: `npm run capture -- livekit-call-lifecycle`.

## Themes

The page has a switch with System, Light, Dark and **Story**, an old-world fantasy theme that is the default until you choose another (the choice is remembered). The switch is the shared `_shared/theme/theme.js`: a demo declares `data-demo-theme`, `data-demo-theme-label` and `data-demo-theme-default` on `<html>` to add a fourth option. The Story theme is `public/theme-story.css`: it overrides design-system tokens on `main` (and on the How it works dialog) and styles the parchment cards, banner, badges and transcript with them, using Cinzel Decorative, Cinzel and IM Fell English from Google Fonts. The Data flow pane is outside `main`, so it keeps the standard look. Headings and microcopy have a plain and a Story version (`only-plain` and `only-story`), so the other themes keep today's wording.

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
npm run simulate -- room_finished --bad-signature   # Event Gateway rejects it (VERIFICATION_FAILED); the app is never called
```

**A failing app.** In the page's failure injection panel, set "Fail the next" to 2 and generate some activity. The app answers 503 to the first two deliveries. Hookdeck keeps the event, retries it, and the call log updates when the app finally answers 200. LiveKit is never kept waiting. Set "Delay each answer" to make the app slow instead.

### Recordings

Recording links come from egress events. Start a room composite egress with an output location you control (see LiveKit's [egress documentation](https://docs.livekit.io/home/egress/overview/)); when it ends, `egress_ended` carries the file location and the app adds it to the call.

## How a turn works

After each player input (a spoken answer) one small separate Inference call (`openai/gpt-4.1-mini`, JSON out) reads the words into `{ move, take, use, give }`. The code validates each part against the world: only real exits from the current place, only items that lie here, the chest opens only with the key, and the Lantern lights only at the lighthouse with the flint and wick. It then gives Bram a note with the place, what lies here, the satchel, the ways out and what just happened, and Bram narrates. Where the party is, the satchel and the puzzle flags are saved in the room metadata, so a resumed story keeps them. Items are not room events, so the satchel is shown from agent attributes (`story.satchel`) and never appears in the chronicle. For a quick test, `STORY_START=cave` starts the party in the cave with the map.

## Known limits

- **A storyteller that dies resumes the story.** After each player turn and each scene change the agent saves the story in the room's metadata: the scene, the names in the ledger, the clues shown and a few lines of running summary (small JSON, a few hundred bytes to about 4 KB). When a story agent joins a room that already has that state, Hester stays out of it and Old Bram opens with a short recap, then the same scene carries on. This covers LiveKit re-dispatching a dead job and the **Continue the story** button, which appears when the storyteller has left the room or has not answered for 20 seconds after a player spoke, and asks the app (`POST /api/story/continue`) to dispatch a new story agent. A second agent in a room that already has a live one leaves, so the story is never told twice. The chronicle notes "The storyteller returned". The saved summary is only the last few lines, so the recap is approximate.
- **Stalls.** A final transcript that never ends the player's turn is recovered after 15 seconds (the turn is committed, then Old Bram says one short line). A model request that hangs is covered after 20 seconds. Turns end on voice activity (700 ms to 3 s of silence), not the local turn-detector model, preemptive generation and session recording are off.
- The agent hears one player at a time, and a mute player (Pixel) takes part through gestures the agent hands it, not audio.
- **Leaving.** A player who leaves is taken out of the turn rotation and Bram's roster, and the turn goes on to someone still in the room. A traveller who joins mid-story without a name is called "Traveller" until they say "I'm Priya". If the closing never plays (a hung reply), the agent speaks a short closing and ends the story anyway, and ignores typed input once the story is ending.

## Tests

```bash
npm test
```

The tests build a call log from a sample event sequence, then check that duplicates, reverse order and a late `egress_updated` give the same result, and that the Hookdeck signature check accepts a signed body and rejects a wrong secret, a changed body and a missing header. The scene and pane tests run in a browser: install one with `npx playwright install chromium` first.

## Replaying a delivery

Every request the app receives is appended to `data/deliveries.jsonl` with its headers and raw body (base64), keeping the last 500. The `Authorization` header is stored as `[redacted]`: it is a bearer token until it expires, and the file shouldn't hold it. To replay an event, use Event Gateway, which keeps the original request: open it in the dashboard and select **Retry**, or run `hookdeck gateway event retry <event-id>`.

## Running it safely

- The app binds to `127.0.0.1` (set `HOST=0.0.0.0` to open it to your network). It mints LiveKit tokens and can start agents and bots, so don't expose it to a network you don't trust.
- A Join only ever goes to a room the app names itself (`story-` and hex digits) or to an open one of those. Continue and Add Pixel accept the same rooms only. At most `MAX_ROOMS` (default 6) stories run at once.
- `POST /api/scene` and `/api/scene/end` need the agent's secret header; the failure-injection controls and data endpoints are for the local page.

## Project structure

```
livekit/voice-adventure/
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
│   ├── hookdeck-api.ts      # Synced from _shared: calls the Hookdeck API with the API key
│   ├── hookdeck-cli.ts      # Synced from _shared: runs the Hookdeck CLI for npm run listen
│   ├── listen.ts            # npm run listen
│   └── setup-hookdeck.ts    # npm run setup
├── src/
│   ├── token.ts             # Mints the short-lived browser token and dispatches the agent
│   ├── chronicle.ts         # Builds the session chronicle from webhooks
│   ├── soundtracks.ts       # Scene names, soundtrack URLs and the HEAD check
│   ├── soundtrack-keeper.ts # Keeps one soundtrack playing per room, restarts it when it ends
│   ├── rooms.ts             # Which rooms a Join may use, the room caps, the agent's secret header
│   ├── call-log.ts          # Turns events into calls (idempotent, order-independent)
│   ├── hookdeck-signature.ts # Verifies x-hookdeck-signature (synced from _shared)
│   ├── server.ts            # Express app and the verified webhook endpoint
│   ├── deliveries.ts        # What the app answered, for the data flow pane
│   └── store.ts             # JSON file persistence in data/
├── test/                    # Call log, scenes and pane tests
└── public/                  # The call log page and the data flow pane
```

## Troubleshooting

- **Webhook not arriving:** check that `npm run listen` is running and that the Hookdeck dashboard shows the event. Use **Actions, Send a test event** in LiveKit Cloud.
- **Requests recorded as `VERIFICATION_FAILED` in Hookdeck:** the API key selected as **Signing API key** in LiveKit must match `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` in `.env`, and `npm run setup` must have copied them to the source.
- **Deliveries rejected with 401 by the app:** `HOOKDECK_SIGNING_SECRET` in `.env` must be the project signing secret from Project settings, Secrets.
- **`lk` can't connect:** `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` must be set in `.env`; the script loads them.

# Retell outbound lead calling with Hookdeck

A lead arrives in the demo app. The page starts a browser call with [Retell AI](https://www.retellai.com/)'s voice agent (optionally the app places an outbound phone call instead), passing the lead's details as dynamic variables. Retell's call events come back through [Hookdeck Event Gateway](https://hookdeck.com/event-gateway) to the app, which updates the lead's status and stores the call summary and analysis.

```
lead form ──► browser web call (public key) ──► Retell agent talks to you
                  (optional: app ──► create-phone-call ──► your phone rings)
                                  │
              call_started / call_ended / call_analyzed
                                  ▼
              Hookdeck RETELL source (verifies x-retell-signature,
              deduplicates, queues, retries) ──► hookdeck listen ──► app
```

Everything you need is in this directory: the app, your Retell account and Hookdeck. There are no other services.

## What it shows

| Hookdeck feature | Where to see it |
|---|---|
| **Signature verification.** The `RETELL` source type verifies `x-retell-signature` (`v=<ms>,d=<hex>`, HMAC-SHA256 over the raw body plus the timestamp) with your webhook-badged Retell API key, so the app contains no verification code. | `npm run probe` sends a correctly signed and a badly signed request and reads Hookdeck's request records (`verified`, `rejection_cause`); `npm run simulate -- call_ended --bad-signature` is rejected |
| **Deduplication.** A connection rule drops a repeat of the same `body.event` for the same `body.call.call_id`. | `npm run simulate -- call_ended --twice` |
| **Retries.** Retell retries an event up to 3 times if it doesn't get a 2xx within 10 seconds. Hookdeck acknowledges immediately and retries delivery to your app with its own schedule. | The failure injection panel in the UI |
| **Local development.** `hookdeck listen` gives Retell a public URL for an app on localhost. | `npm run listen` |
| **Live-call injection** (optional). A custom function in "Run in background" mode whose result the app injects later with `PATCH /v2/update-live-call/{call_id}`. | `ENABLE_LIVE_INJECTION=true` |

## Before you start

You need three things from outside this repo (a fourth, a phone number, is optional).

1. **A Hookdeck project API key.** [Sign up for free](https://dashboard.hookdeck.com/signup), then open Project settings, API keys.
2. **A Retell account, its API key and its webhook key.** In the Retell dashboard, open Settings, API Keys. Retell signs every webhook with the one key designated as the webhook key, and Hookdeck verifies with the same key. Put that key in `RETELL_SECRET_KEY` (or leave it empty if it's the key in `RETELL_API_KEY`); setup gives it to the Hookdeck source. Only one key can be the webhook key at a time. If you restrict this key's permissions, it needs Agent Edit and Call Edit (see [Manage API keys](https://docs.retellai.com/accounts/manage-api-keys)).
3. **A Retell public key, for the browser call.** In the Retell dashboard open **API Keys**, then **Public Keys**, create a key and add `localhost` to its allowed domains ([Public keys](https://docs.retellai.com/accounts/public-keys)). Put it in `RETELL_PUBLIC_KEY`. A public key is meant for browser code: Retell only accepts it from the domains you allow, and the app hands it to the page. Your API key never reaches the browser.
4. **Optional, for phone calls: a Retell phone number**, used as the caller ID. Add a payment method, then open Phone Numbers in the sidebar, choose **Add number**, then **Buy new number** ([Purchase phone number](https://docs.retellai.com/deploy/purchase-number)). Some newly purchased numbers have a 2-minute hold on outbound calls, during which the create-call API returns HTTP 409. Retell-managed numbers can call [15 countries](https://docs.retellai.com/deploy/international-call). The demo calls one number, your own mobile, set in `.env`; the form has no phone field, so the app can't be used to dial anyone else.

## Quick start

```bash
npm install
cp .env.example .env
```

Fill in `.env`: `HOOKDECK_API_KEY`, `RETELL_API_KEY`, `RETELL_SECRET_KEY` (the webhook key, if it's a different key) and `RETELL_PUBLIC_KEY`. For phone calls only, also `RETELL_FROM_NUMBER` (the number you bought, E.164) and `TEST_LEAD_PHONE_NUMBER` (your mobile, E.164).

```bash
npm run setup     # creates the Hookdeck connection and the Retell agent, writes the rest of .env
npm run listen    # terminal 1: forwards events to http://localhost:4000/webhooks/retell
npm start         # terminal 2: the app on http://localhost:4000 (bound to 127.0.0.1; set HOST to change)
```

Open <http://localhost:4000>, fill in the enquiry and choose **Have Sam call Alex** (the lead's name comes from the form). Allow the microphone and answer as the lead: Sam is the agent, you play the lead. The browser uses Retell's [`RetellClient`](https://docs.retellai.com/deploy/web-call) (`retell-client-js-sdk` 3.0.4, loaded pinned from esm.sh) with your public key; the lead's details and `metadata.lead_id` go with the call, so the same three webhooks come back for it. The lead moves through **Calling**, **In call**, **Call ended** and **Analyzed**, with each event on its timeline. The summary and the extracted fields (budget, move-in timeline, whether a viewing was requested) appear when `call_analyzed` arrives, shortly after the call ends.

If `RETELL_PUBLIC_KEY` is missing, the page says what to add and where to find it.

**Optional: a phone call.** With `RETELL_FROM_NUMBER` and `TEST_LEAD_PHONE_NUMBER` set, **Submit enquiry and have Sam call** places an outbound call with `POST /v2/create-phone-call` and your phone rings.

### What `npm run setup` creates

| Where | What |
|---|---|
| Hookdeck | Source `retell-call-events` (type `RETELL`, secret = your Retell API key), CLI destination `local-retell-call-events` (`/webhooks/retell`), connection `retell-call-events` with a deduplicate rule (`body.event` + `body.call.call_id`, 10 minutes) and an exponential retry rule (8 attempts from 30 seconds) |
| Retell | A Retell LLM (the prompt, `{{lead_name}}`, `{{property_interest}}`, `{{lead_notes}}`) and a voice agent with `webhook_url` set to the Hookdeck source URL, `webhook_events` of `call_started`, `call_ended` and `call_analyzed`, and post-call analysis fields |

The webhook URL is set on the agent, so it overrides the account-level webhook and your other Retell agents are unaffected. To receive every agent's events instead, enter the Hookdeck source URL (`RETELL_EVENTS_URL` in `.env`) on the dashboard's Webhooks tab and remove `webhook_url` from the agent.

## The Data flow pane

The page has a **Data flow** pane at the bottom, open by default. **Live** shows the demo as it runs: starting a call sends a packet from the app to Retell's API, and each webhook travels from Retell through Event Gateway (verify, store, dedup, retry) and `hookdeck listen` to the app. Click a node or a packet for that message's details below the diagram: verified or rejected, each delivery attempt, what the app answered, and a **View in Hookdeck** link. The other tabs play scripted scenes with captions: **Call lifecycle**, **Duplicate dropped**, **Bad signature** and **App down, retry succeeds**. With `ENABLE_LIVE_INJECTION=true`, the live view also shows the agent's function request reaching the app and the app's `update-live-call` result going back to Retell.

The pane is fed by the app's own record of what it handled (`/api/deliveries`, `/api/outbound`) for the fast path, and by `/api/flow` (Event Gateway's API, read with `HOOKDECK_API_KEY` on the server) for rejected requests and duplicates, which never reach the app. Event Gateway lists a request about 3 seconds after it arrives, so those two animate a few seconds late.

The scenes live in `scenes/retell-calls.ts` (the kit in `scenes/kit/` is synced from `_shared/scenes`). MP4 captures of the four scenes, landscape and square, are in `scenes/captures/`. To render them again: `npm run capture -- retell-call-lifecycle`.

## The page: layout, themes and the retry ladder

**Focused layout.** The main view keeps labels, data, actions and status. Explanations sit behind ⓘ buttons (a dialog: Esc, the Close button or a click outside closes it, and focus returns to the button) and hover tips on single controls (also shown on keyboard focus). `public/info.js` is the small script behind both.

**Themes.** The switch has System, Light, Dark and **Open house** (the default: Acme Realty, with ivory, forest green and brass, set in Fraunces). Open house is `public/theme-open-house.css`, which overrides the design-system tokens only under `html[data-theme="open-house"] main` and on the dialogs, so the Data flow pane never changes, and `public/theme-open-house.copy.js`, the wording only that theme changes (the title, the card headings, the status badge labels). Roles wording (Sam, the lead, the enquiry) is in `index.html` and applies in every theme. The mechanism is `_shared/theme/theme.js`, synced to `public/theme.js`.

**Retry ladder.** When a verified `call_ended` has a `disconnection_reason` of `dial_no_answer`, `dial_busy` or `voicemail_reached`, `src/retry.ts` schedules the next attempt (`RETRY_DELAY_SECONDS`, default 120) up to three attempts, then marks the lead "Gave up". The lead card shows "Attempt 2 of 3", a countdown and the attempts as dots. The app never dials by itself: when the countdown ends the call button is ready, and pressing it starts the next web call on the same lead. To see it without a paid call, press **Lead does not answer** (or run `npm run simulate -- --no-answer`): a signed `call_ended` with `dial_no_answer` goes to your Hookdeck source, so it is verified, delivered and applied like Retell's own. When attempt 2 rings, `npm run simulate` answers and analyzes it. The ladder does not redial a phone-call lead on its own.

**Demo only.** The schedule is a timestamp on the lead that the page watches, and a "retry" re-arms the browser call (or a simulated ring) on the same lead; it does not place a phone call. Production needs a scheduler or queue (a delayed job, or a sweep over `next_attempt_at`) that dials server-side, survives restarts and respects calling hours and consent. Each attempt is its own call: the phone path's idempotency key is `lead-<id>-<attempt>`, a late event for an earlier attempt's call is recorded as "stale call" and ignored, and if the retry's call fails to start the lead goes back to waiting for its next attempt.

## Try the reliability features

**Verification and deduplication, without a call.** With the app and `npm run listen` running:

```bash
npm run simulate                          # signed call_started, call_ended, call_analyzed
npm run simulate -- call_ended --twice    # second one is deduplicated
npm run simulate -- call_ended --bad-signature
npm run simulate -- --no-answer           # a new simulated lead that does not pick up: starts its retry ladder
```

In the Hookdeck dashboard, the duplicate appears as an ignored event and the bad signature as a rejected request.

**A failing app.** In the app's failure injection panel, set "Fail the next" to 2 and place a call. The app answers 503 to the first two deliveries. Hookdeck keeps the event, retries it, and the lead updates when the app finally answers 200. Retell is never kept waiting, so it never retries by itself. Set "Delay each answer" to make the app slow instead.

**Replay.** Select an event in the Hookdeck dashboard or the `hookdeck listen` terminal and retry it. The app records the repeat on the timeline as a duplicate and leaves the lead unchanged.

## Optional: inject a result into the live call

With `ENABLE_LIVE_INJECTION=true` in `.env` before `npm run setup`, the agent also gets a custom function, `check_viewing_slots`, that points at a second Hookdeck source (`retell-live-function`, also type `RETELL`: Retell signs custom function requests with the same header). When the lead names a day, the agent calls the function and carries on talking. The app acknowledges, waits four seconds (a stand-in for a slow calendar lookup), then calls `PATCH /v2/update-live-call/{call_id}` with `call_control.additional_context` and `trigger_response: true`, and the agent offers the slots.

The function must be in **Run in background** mode so Retell doesn't wait for the response ([custom function docs](https://docs.retellai.com/build/single-multi-prompt/custom-function)). Check this under the agent's function settings in the Retell dashboard after `npm run setup`.

## Project structure

```
retell/outbound-lead-calling/
├── .env.example
├── scripts/
│   ├── setup.ts          # Hookdeck source/destination/connection + Retell LLM and agent
│   ├── listen.ts         # hookdeck listen for the demo's sources
│   ├── simulate.ts       # signed sample events, duplicates, bad signatures
│   ├── probe.ts          # signed + badly signed requests, checked against Hookdeck's request records
│   └── hookdeck-cli.ts   # shared helper (_shared/hookdeck): runs the CLI against the API key's project
├── src/
│   ├── server.ts         # form API, webhook endpoints, failure injection
│   ├── retell.ts         # create-phone-call and update-live-call (the web call runs in the browser)
│   ├── events.ts         # call events -> lead status, summary, analysis (idempotent per call)
│   ├── retry.ts          # the retry ladder: which calls are retried, when, and when to give up
│   ├── simulated.ts      # signed stand-in events, for simulate and "Lead does not answer"
│   ├── retell-signature.ts
│   └── store.ts          # leads in data/leads.json
├── public/               # the page: form, roles, lead list, ⓘ dialogs, Open house theme
└── test/                 # npm test: events, retry ladder, theme wording
```

## Security notes

- **The webhook endpoint trusts the network path.** Event Gateway verified Retell's signature, and `hookdeck listen` forwards to `localhost`, so `/webhooks/retell` checks nothing itself. The app binds to `127.0.0.1` for that reason. A deployed endpoint that is reachable from the internet must verify Hookdeck's signature (`x-hookdeck-signature`) before it applies an event.
- **Form text is capped** (name 80, property 120, notes 500 characters) before it goes into the agent's dynamic variables, and the phone path waits `PHONE_DIAL_MIN_INTERVAL_SECONDS` (default 30) between calls.
- **An event for a lead the app does not know** (for example after `data/` was wiped) is acknowledged with 200 and logged, because redelivering it could never find the lead. A body that is not a Retell call event gets 400.

## Troubleshooting

- **A request shows `VERIFICATION_FAILED` in Hookdeck.** The key setup gave the source (`RETELL_SECRET_KEY`, or `RETELL_API_KEY` when that's empty) isn't the key with the webhook badge in the Retell dashboard. Fix `.env`, then run `npm run setup` again.
- **The call is created but nothing arrives.** Check that `npm run listen` is running. If it wasn't when the request arrived, Hookdeck stored the request but made no event for the CLI: start it, then replay the request.
- **The browser call says it was rejected or the key is not allowed.** The public key's allowed domains must include `localhost` (or the host you opened the page on).
- **HTTP 409 when creating the phone call.** A newly purchased Retell number can have a 2-minute outbound hold. Wait and retry.
- **HTTP 402.** The Retell workspace needs a payment method or credit.

## Tests

```bash
npm test
```

Covers the event handling and the signature scheme with payloads signed by the test itself, the retry ladder, and the theme wording swap (the scene tests need a Playwright browser).

## Learn more

- [Retell webhooks overview](https://docs.retellai.com/features/webhook-overview)
- [Secure the webhook](https://docs.retellai.com/features/secure-webhook)
- [Make a web call](https://docs.retellai.com/deploy/web-call) and [Public keys](https://docs.retellai.com/accounts/public-keys)
- [Create phone call](https://docs.retellai.com/api-references/create-phone-call)
- [Update live call](https://docs.retellai.com/api-references/update-live-call)

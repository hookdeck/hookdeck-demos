# Vapi agency routing

A voice AI agency routes each client's Vapi call events to that client's endpoint through Hookdeck, with an async tool that returns its result into the live call.

## Set up

1. Copy `.env.example` to `.env` and set `VAPI_API_KEY` (private), `VAPI_PUBLIC_KEY` (public, for the Start call buttons) and `HOOKDECK_API_KEY`. Both Vapi keys are at https://dashboard.vapi.ai/org/api-keys.
2. `npm install`, then `npm run setup` (creates the Hookdeck sources and connections and the Vapi credential, tool and assistants).
3. `npm run listen` in one terminal and `npm start` in another.

## Make a test call

No Vapi dashboard needed.

1. Open http://localhost:4000.
2. In the Acme Dental column, click **Start call** and allow microphone access.
3. Say: "Hi, I'm Priya Shah, what's my next appointment?" The assistant says it is checking, then stays quiet; about 6 seconds later the CRM result is spoken into the call.
4. Click **End call**. Repeat in the Globex Plumbing column with: "Hi, I'm Maria Lopez, when is my plumber coming?"

Each column shows the events that arrived through that client's Hookdeck source. The page loads the Vapi Web SDK (`@vapi-ai/web`, pinned) from esm.sh; the server only exposes `VAPI_PUBLIC_KEY` and the assistant IDs at `/api/config`.

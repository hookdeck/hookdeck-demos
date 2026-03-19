# Hookdeck CLI Guest Mode Demo Video Plan

## 🎬 Overview

This video demonstrates how developers can test and debug webhook integrations locally using the Hookdeck CLI — **no account required**. It walks through running a local server, receiving real events in guest mode, inspecting payloads, retrying deliveries, and filtering noise.

---

## 1. Start Local Server

**Terminal 1:**

```bash
npm run dev
```
> Starts a local webhook receiver on port 3000.

---

## 2. Start Hookdeck in Guest Mode

**Terminal 2:**

```bash
hookdeck listen 3000 shopify
```
> Hookdeck prints a unique event URL for the “shopify” source.  
> The TUI opens, showing connection details and “Waiting for events…”

---

## 3. Send Shopify-like Events

**Terminal 3:**

Use `curl` to trigger three different Shopify-style webhook events.

```bash
# Order created
curl -X POST https://events.hookdeck.com/e/src_example   -H "Content-Type: application/json"   -H "X-Shopify-Topic: orders/create"   -d '{"id":1001,"email":"alice@example.com","total_price":"29.99"}'

# Product updated
curl -X POST https://events.hookdeck.com/e/src_example   -H "Content-Type: application/json"   -H "X-Shopify-Topic: products/update"   -d '{"id":2002,"title":"T-shirt","variants":[{"id":1,"price":"19.99"}]}'

# Inventory level updated
curl -X POST https://events.hookdeck.com/e/src_example   -H "Content-Type: application/json"   -H "X-Shopify-Topic: inventory_levels/update"   -d '{"inventory_item_id":3003,"available":42}'
```

> Each event arrives instantly in the Hookdeck TUI with clear status indicators.

---

## 4. Observe Incoming Events

- Watch the TUI populate with three events.
- Each line shows a timestamp, method, and destination.
- The selected event (`>`) highlights for navigation.

---

## 5. Navigate Events

- Use **↑** and **↓** to move between events.
- Highlight `X-Shopify-Topic` in the header column to show event types.

---

## 6. Inspect Event Details

- Press **d** to open the detailed view.
  - Scroll through headers and body.
  - Show that both request and response are visible.
- Press **ESC** to return to the event list.

---

## 7. Retry a Failed Event

- Select an event and press **r** to replay it.
- The event is resent to the local server and displayed again in real time.
> Demonstrates the instant replay capability.

---

## 8. Apply a Filter to Focus on One Event Type

- Quit the current session (**q**), then run:

```bash
hookdeck listen 3000 shopify --filter-headers '{"X-Shopify-Topic": "orders/create"}'
```

- Re-run the `curl` commands.
- Only the **orders/create** event appears.

> Demonstrates live filtering for focused debugging.

---

## 9. Show Error + Retry Recovery (Optional)

- Stop the local server temporarily.
- Send another `curl` for `products/update`.
- Event appears with an error status (connection refused).
- Restart server, select the event, and press **r**.
- The retry succeeds, confirming resilience.

---

## 10. Wrap-Up

- Quit the session (**q**).
- Overlay text:  
  **“No setup. No tunnels. No expiry.”**
- Optional:  
  “Login anytime to persist and share your events.”

---

## 🧩 Highlights in this Flow

- 100% local and guest mode — no account needed.  
- Permanent event URL for each session.  
- Interactive TUI for navigation, inspection, and retries.  
- Realistic Shopify-like payloads.  
- Filtered debugging for targeted testing.  
- Optional failure/retry demo for reliability showcase.

---

## ✅ Outcome

After this demo, viewers clearly understand that:

- Hookdeck CLI works instantly with no setup.  
- They can test real webhook integrations locally.  
- The CLI offers visibility and control other tunnel tools don’t.  
- Login is optional, but available for persistent team workflows.

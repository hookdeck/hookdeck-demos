# Hookdeck Deduplication Demo - Sender-Only

This guide explains how to run the TypeScript demo scripts to demonstrate **deduplication** in the Hookdeck Event Gateway by sending events directly to Hookdeck Sources.

---

## 1. Install dependencies

```bash
npm install
```

---

## 2. Setup Hookdeck Connection

In the Hookdeck Event Gateway:
- Create or select a **Source**
- Create a **Connection** from that Source to your destination. For simplicity, use a **Mock** destination
- Copy your Source URL (format: `https://hkdk.events/{id}`)

Set the `SOURCE_URL` environment variable:

```bash
export SOURCE_URL=https://hkdk.events/{id}
```

---

## 3. Send baseline duplicates (dedupe OFF)

Make sure deduplication is **disabled**.

Then run:

```bash
# Two identical payloads (same event_id, timestamp, and content)
npm run send:dupe:same-payload -- --url $SOURCE_URL
```

**Expected:** **Two events** are sent to Hookdeck and **two deliveries** are made to the Destination.

---

## 4. Deduplicate with full event

In the Hookdeck Console:
- Open **Connections**
- Turn on **Deduplication**
  - Use **all event data**
- Run `send:dupe:same-payload` (identical payloads)

**Expected:** **Two events** are sent to Hookdeck and **one delivery** is made to the Destination.

---

## 5. Re-send with different timestamps

Run the script:

```bash
npm run send:dupe:different-timestamp -- --url $SOURCE_URL
```

**Expected:**
- **Two events** are sent to Hookdeck and both are delivered because the event IDs are the same, but the timestamps are different.

---

## 6. Exclude fields

In the Hookdeck:
- Open **Connections**
- Turn on **Deduplication**
  - Exclude **Field: timestamp**
- Run `send:dupe:different-timestamp` (same event_id, different timestamps)

**Expected:** **Two events** are sent to Hookdeck and **one delivery** is made to the Destination.

---

## 7. Composite fields

There are scenarios where you may want to use two or more field changes to identify if a destination is interested in an event.

For example, if you have an inventory system that is just interested in stock levels, you might include both the `event_id`, `sku`, and `stock_level` fields for uniqueness detection.

- Create new Connection using existing Source
- Set up Deduplication with fields `event_id`, `sku`, and `stock_level`
- Set destination to be new Mock endpoint called `ecomm-inventory`

---

## 8. Note on rule order

Deduplication rules are applied based on the order they are defined on the connection in combination with Filter and Transformation rules.

## 9. Optional: send a burst with duplicates

```bash
npm run send:flood -- --url $SOURCE_URL --count 25 --dupePercent 60
```

This sends multiple events with a specified percentage of duplicates, useful for demonstrating deduplication at scale.

---

## Additional Scripts

### Send a single event
```bash
npm run send:one -- --url $SOURCE_URL
```

---

## Talking points for demo

- "I'm sending duplicate events to Hookdeck - notice both are being delivered to the destination."
- "Now I'll enable deduplication in the Hookdeck dashboard."
- "When I send the same duplicates again, only one delivery reaches the destination, and duplicates are discarded at the gateway."
- "At scale, this prevents retry storms, duplicate processing, and wasted resources."

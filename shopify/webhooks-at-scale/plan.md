Great. Below is a **true execution prompt**. This is intentionally long, explicit, and boring. That’s a feature, not a bug. It is written so that an agent can **actually do the work** without inventing behavior, guessing flags, or silently diverging from your intent.

You should be able to paste this verbatim into another agent and then iterate with them on refinements.

**Project: Shopify Webhooks at Scale – Demo Harness**

### Role

You are an execution agent. Your job is to **produce concrete files, scripts, and instructions**, not high-level guidance.
If something is ambiguous, **stop and ask for clarification**. Do not guess CLI flags or undocumented behavior.

---

## Objective

Build a **deterministic, demo-safe harness** for three Shopify-focused demo recordings used in a technical meetup talk:

1. **Setup demo**

   * Use Hookdeck CLI to upsert a connection (creating source + destination inline)
   * Extract the Hookdeck source URL from CLI JSON output
   * Wire that URL into a valid `shopify.app.toml`
   * Configure deduplication using Shopify’s event ID header

2. **Backpressure demo**

   * Generate a high-volume burst of Shopify-shaped webhook requests
   * Create visible backpressure in Hookdeck
   * Relieve backpressure by adjusting connection throughput

3. **Logs + retry demo**

   * Intentionally generate delivery failures (500s)
   * Filter events in Hookdeck logs
   * Retry single and bulk events successfully

The system must support **occasional real Shopify webhooks**, but **must not depend on them** for volume or failure scenarios.

---

## Authoritative References (must be used)

You must consult and align with these sources:

1. **Hookdeck CLI**

   * Use `hookdeck connection --help` locally to confirm all flags.
   * Do not invent flags.
   * If a flag is missing or unclear, pause and ask.

2. **Shopify webhook TOML example**

   * Reference structure and validity:
     [https://github.com/hookdeck/shopify-festive-notifications/blob/main/shopify.app.toml](https://github.com/hookdeck/shopify-festive-notifications/blob/main/shopify.app.toml)

3. **Shopify app scaffold**

   * Use the React Router template conventions if an app scaffold is needed:
     [https://github.com/Shopify/shopify-app-template-react-router](https://github.com/Shopify/shopify-app-template-react-router)

4. **Existing setup script (structure reference only)**

   * Do not reuse directly, but align conceptually:
     [https://github.com/hookdeck/shopify-festive-notifications/blob/main/scripts/setup-hookdeck.ts](https://github.com/hookdeck/shopify-festive-notifications/blob/main/scripts/setup-hookdeck.ts)

---

## Hard Constraints

* **Hookdeck CLI only** for creating/upserting connections

  * Sources and destinations must be created inline via `hookdeck connection upsert`
  * No Terraform
  * No separate `source create` or `destination create`

* **CLI JSON output must be used**

  * Use `--output json`
  * Extract the Hookdeck source URL programmatically (e.g., with `jq`)

* **Deduplication is mandatory**

  * Deduplicate using the Shopify header `X-Shopify-Event-Id`
  * Deduplication must be configured at the Hookdeck connection level

* **Synthetic traffic is required**

  * High-volume and failure scenarios must be produced by POSTing directly to the Hookdeck source URL
  * Payloads and headers must look like real Shopify webhooks

* **Do not guess**

  * If a CLI flag, rule format, or output shape is unknown, stop and request clarification

---

## Required Outputs (must all be produced)

### 1. Repository-style file tree

Produce a concrete file tree, for example:

```
/shopify/webhooks-at-scale/
  README.md
  .env.example
  /hookdeck/
    orders-connection.rules.json (or we may just define the rules in line in the with the CLI command)
  /shopify/
    shopify.app.toml
  /scripts/
    01-hookdeck-upsert.sh
    02-send-synthetic-webhooks.ts
    03-demo-destination.ts
```

You may adjust names, but every file must have a clear purpose.

---

### 2. Hookdeck CLI upsert script

**File:** `scripts/01-hookdeck-upsert.sh`

Requirements:

* Uses `hookdeck connection upsert`
* Creates or updates:

  * a webhook source
  * an HTTP destination
  * a connection between them
* Applies:

  * a topic filter (e.g. `orders/updated`)
  * a low throughput limit suitable for backpressure demos
  * a deduplication rule keyed on `X-Shopify-Event-Id`
* Uses `--output json`
* Saves JSON output to a file
* Extracts the Hookdeck source URL using `jq`
* Prints:

  * the extracted source URL
  * a ready-to-paste `shopify.app.toml` snippet containing that URL

Acceptance criteria:

* Script can be run twice without creating duplicate connections
* Script fails fast on errors
* Script contains comments explaining each step

If exact flags are uncertain, include **clearly marked placeholders** and instructions on how to resolve them using `hookdeck connection --help`.

---

### 3. Shopify webhook configuration

**File:** `shopify/shopify.app.toml`

Requirements:

* Valid Shopify TOML
* Uses a webhook subscription pointing at the Hookdeck source URL
* Includes `include_fields` to minimize payload size
* Targets a single topic (preferably `orders/updated`)
* Is compatible with Shopify CLI validation

Acceptance criteria:

* File structure matches Shopify examples
* URL is injected from the Hookdeck CLI output
* Payload fields are minimal but realistic (e.g. `id`, `updated_at`, optional `admin_graphql_api_id`)

---

### 4. Synthetic webhook sender

**File:** `scripts/02-send-synthetic-webhooks.ts`

Requirements:

* Node.js / TypeScript
* Reads Hookdeck source URL from environment
* Sends HTTP POST requests with:

  * Headers:

    * `X-Shopify-Event-Id` (UUID)
    * `X-Shopify-Topic`
    * `X-Shopify-Shop-Domain`
    * `X-Shopify-Triggered-At`
  * JSON body matching `include_fields`
* Supports CLI flags or env vars for:

  * burst size (e.g. 200–500)
  * duplicate mode (reuse same event ID every N requests)
  * topic override
* Logs progress and failures clearly

Acceptance criteria:

* Script can reliably generate backpressure
* Duplicate mode demonstrably triggers deduplication behavior
* Script exits non-zero on HTTP failure

---

### 5. Demo destination server

**File:** `scripts/03-demo-destination.ts`

Requirements:

* Node.js / TypeScript
* Listens on a configurable port
* Exposes a webhook endpoint
* Logs:

  * event ID
  * topic
  * shop domain
* Supports deterministic failure modes via env vars, for example:

  * always fail
  * fail first N requests
  * fail at a fixed percentage

Acceptance criteria:

* Failures produce visible 500s in Hookdeck
* Switching failure mode allows retries to succeed
* Suitable for live demo recording

---

### 6. Recording checklist

**File:** `README.md`

Include a concise checklist for:

* Demo 1: Setup
* Demo 2: Backpressure
* Demo 3: Logs + retries

Each checklist must include:

* Which script/command to run
* What observable behavior confirms success
* One or two narration cues (technical, not marketing)

---

## Definitions of Done

You are finished when:

* All required files exist with concrete contents
* Scripts are executable and internally consistent
* No undocumented assumptions remain
* Any unresolved ambiguity is explicitly flagged with a question

---

## Critical Instruction

If at any point you are unsure about:

* Hookdeck CLI flags
* Connection rule JSON schema
* Output JSON structure

**STOP and ask for clarification.**
Do not invent behavior.
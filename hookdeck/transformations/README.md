# Transformations with Node.js built-ins

Hookdeck transformations can import Node.js built-in modules (`node:zlib`, `node:crypto`, `node:buffer`, ...) and change a payload to any content type. Each example here is a connection with its own transformation: a JSON event goes in, and the destination receives an image, audio, a PDF, an SVG, a signed request, or JSON decompressed from a binary payload. There are no npm packages and no bundling, just the built-ins.

A local UI sends each example's input and follows the event through four stages:

- **Source:** the input, and whether ingestion accepted it.
- **Transformation:** its console output, read from the transformation executions API, and its code with the built-in imports highlighted.
- **Destination:** a CLI destination, delivered by `hookdeck listen` to this server, with the headers that arrived.
- **Result:** what arrived, rendered, and a check of it (a valid PNG, the HMAC verifies, the event count matches, ...).

## Examples

| Example | Built-ins | Input | Output |
|---|---|---|---|
| [`receipt-card`](transformations/receipt-card.js) | `node:crypto`, `node:zlib` | Stripe-style `payment_intent.succeeded` | `image/png`: a receipt card with a 5x7 pixel font and an identicon (generated avatar) hashed from the customer ID, encoded with `deflateSync` and `crc32` |
| [`incident-chime`](transformations/incident-chime.js) | `node:buffer` | Incident triggered / acknowledged / resolved | `audio/wav`: a tone synthesised sample by sample, rising when resolved and falling when triggered |
| [`invoice-pdf`](transformations/invoice-pdf.js) | `node:zlib`, `node:crypto` | Shopify-style order | `application/pdf`: written by hand, with a deflate-compressed content stream and an MD5 document ID |
| [`latency-chart`](transformations/latency-chart.js) | none | Uptime check results | `image/svg+xml`: a latency chart with failures marked. A string body can carry any content type |
| [`sign-hmac`](transformations/sign-hmac.js) | `node:crypto` | Any JSON event | `application/json` plus an `x-signature` header: HMAC-SHA256 of `timestamp.body`, with the secret in the transformation's environment variables |
| [`gunzip-batch`](transformations/gunzip-batch.js) | `node:zlib` | Gzip-compressed NDJSON (`Content-Encoding: gzip`) | `application/json`: the reverse direction, binary bytes in and JSON out |

Each transformation is a plain ES module with a default export, so it also runs in Node.js as is.

## Run it

Requirements: Node.js 20+ and a Hookdeck Event Gateway project you can create resources in. The Hookdeck CLI (3.1.0) is an npm dependency.

```sh
cp .env.example .env   # add HOOKDECK_API_KEY, and optionally HOOKDECK_WEBHOOK_SECRET
npm install
npm start              # http://localhost:4400
```

`npm start` upserts the resources and starts `hookdeck listen` on all six sources. To push changes to a transformation without the UI, edit `transformations/<id>.js` and run `npm run setup`.

`npm run setup` uses the Hookdeck API, not the CLI, to upsert three resources per example:

- the transformation `transformations-<id>`, with its code and environment variables
- the source `transformations-<id>`
- the connection `transformations-<id>`, from that source to the shared CLI destination `local-transformations` (path `/receive`), with the transformation as a rule

## Notes

- **Binary input:** a transformation sees a binary body (`gunzip-batch`) as a `Buffer` only when the server's `TRANSFORMATION_BINARY_BODIES_ENABLED` is on. It is on in production as of 2026-10-15; with it off, `request.body` is `null`.
- **Signing a JSON body:** returning the signed JSON as a string doesn't work. With a JSON content type, Hookdeck serializes the body again, so it arrives as a JSON string literal. When the JSON is unchanged, Hookdeck delivers the original request bytes, so `sign-hmac` leaves the body as an object and signs `JSON.stringify(request.body)`. That matches the delivered bytes only when the sender's JSON was compact, which is why the demo sends compact JSON.
- **Execution timeout:** transformations have a 1 second execution timeout. Rendering the PNG, WAV and PDF takes well under that.

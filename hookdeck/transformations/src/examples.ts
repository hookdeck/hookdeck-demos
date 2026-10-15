/**
 * The examples: each gets its own source, transformation and connection. The
 * transformation code lives in transformations/<id>.js.
 */
import { createHmac } from "node:crypto";
import { gzipSync } from "node:zlib";

export interface Input {
  label: string;
  contentType: string;
  headers?: Record<string, string>;
  body: Buffer;
  /** What the page shows as the input, when the body itself isn't readable */
  display?: string;
}

export interface Check {
  ok: boolean;
  detail: string;
}

export interface Example {
  id: string;
  title: string;
  summary: string;
  modules: string[];
  inputs: Input[];
  env?: Record<string, string>;
  /** Checks what arrived at the destination */
  check(body: Buffer, headers: Record<string, string | string[] | undefined>, input: Input): Check;
}

// Compact, as most providers send it; the page pretty-prints it
const json = (label: string, value: unknown): Input => ({
  label,
  contentType: "application/json",
  body: Buffer.from(JSON.stringify(value)),
});

const header = (headers: Record<string, string | string[] | undefined>, name: string) => {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
};

// Shared with the transformation through its environment variables. Read when
// used, so it comes from .env whichever module loads first.
const webhookSecret = () => process.env.HOOKDECK_WEBHOOK_SECRET || "demo_webhook_secret";

const payment = (customer: string, email: string, amount: number, description: string) =>
  json(customer, {
    id: `evt_${createHmac("sha256", customer).digest("hex").slice(0, 24)}`,
    type: "payment_intent.succeeded",
    data: {
      object: {
        id: `pi_${createHmac("sha256", email).digest("hex").slice(0, 14)}`,
        object: "payment_intent",
        amount,
        currency: "usd",
        customer,
        description,
        receipt_email: email,
        status: "succeeded",
      },
    },
  });

const batch = (count: number): Input => {
  const kinds = ["page.viewed", "button.clicked", "form.submitted", "page.viewed", "signup.completed"];
  const lines = Array.from({ length: count }, (_, i) =>
    JSON.stringify({ event: kinds[i % kinds.length], user: `u_${100 + (i % 3)}`, ts: 1792060000 + i * 7 }),
  );
  const ndjson = lines.join("\n") + "\n";
  return {
    label: `${count} events`,
    contentType: "application/x-ndjson",
    headers: { "Content-Encoding": "gzip" },
    body: gzipSync(ndjson),
    display: ndjson,
  };
};

/** 30 checks a minute apart; a deterministic wobble, a spike and `failures` failed checks from the end */
const checks = (monitor: string, seed: number, failures: number): Input => {
  const start = Date.UTC(2026, 9, 15, 9, 0);
  return json(monitor, {
    monitor,
    checks: Array.from({ length: 30 }, (_, i) => {
      const wobble = Math.round(40 * Math.sin((i + seed) / 2.5) + 25 * Math.sin((i * seed) / 3));
      const spike = i > 20 && i < 25 ? 260 : 0;
      const failed = i >= 30 - failures - 3 && i < 30 - 3;
      return {
        at: new Date(start + i * 60_000).toISOString().slice(11, 16),
        latency_ms: 140 + wobble + spike + (failed ? 400 : 0),
        status: failed ? "timeout" : "up",
      };
    }),
  });
};

export const examples: Example[] = [
  {
    id: "receipt-card",
    title: "Payment → PNG receipt card",
    summary:
      "Draws a receipt with a 5x7 pixel font and an identicon (generated avatar) hashed from the customer ID, then encodes it as a PNG.",
    modules: ["node:crypto", "node:zlib"],
    inputs: [
      payment("cus_Q9F3kLm2xT", "ada@example.com", 125000, "Pro plan - annual"),
      payment("cus_R2bV8nPq4W", "grace@example.com", 4900, "Starter plan - monthly"),
      payment("cus_T7hJ1sKd9Z", "alan@example.com", 1999900, "Enterprise - 3 year"),
    ],
    check(body, headers) {
      const png = body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      if (!png) return { ok: false, detail: "Not a PNG" };
      return { ok: true, detail: `PNG ${body.readUInt32BE(16)}x${body.readUInt32BE(20)}` };
    },
  },
  {
    id: "incident-chime",
    title: "Incident alert → WAV chime",
    summary:
      "Synthesises a bell-like tone sample by sample into a Buffer: a rising arpeggio when an incident resolves, falling when it triggers.",
    modules: ["node:buffer"],
    inputs: [
      json("triggered", { event_type: "incident.triggered", incident: { id: "INC-2041", title: "Checkout latency above 2s", urgency: "high" } }),
      json("acknowledged", { event_type: "incident.acknowledged", incident: { id: "INC-2041", title: "Checkout latency above 2s", assignee: "ada" } }),
      json("resolved", { event_type: "incident.resolved", incident: { id: "INC-2041", title: "Checkout latency above 2s", duration_minutes: 14 } }),
    ],
    check(body) {
      const wav = body.subarray(0, 4).toString() === "RIFF" && body.subarray(8, 12).toString() === "WAVE";
      if (!wav) return { ok: false, detail: "Not a WAV file" };
      const seconds = body.readUInt32LE(40) / body.readUInt32LE(28);
      return { ok: true, detail: `WAV ${body.readUInt32LE(24)} Hz, ${seconds.toFixed(2)}s` };
    },
  },
  {
    id: "invoice-pdf",
    title: "Order → PDF invoice",
    summary:
      "Writes a PDF by hand: objects, a deflate-compressed page content stream, a cross-reference table, and an MD5 document ID.",
    modules: ["node:zlib", "node:crypto"],
    inputs: [
      json("#1042", {
        admin_graphql_api_id: "gid://shopify/Order/820982911946154508",
        name: "#1042",
        created_at: "2026-10-15T09:12:44-04:00",
        currency: "USD",
        total_price: "214.00",
        customer: { name: "Ada Lovelace", email: "ada@example.com" },
        line_items: [
          { title: "Analytical Engine T-shirt", quantity: 2, price: "32.00" },
          { title: "Difference Engine poster", quantity: 1, price: "150.00" },
        ],
      }),
      json("#1043", {
        admin_graphql_api_id: "gid://shopify/Order/820982911946154509",
        name: "#1043",
        created_at: "2026-10-15T11:40:02-04:00",
        currency: "EUR",
        total_price: "89.50",
        customer: { name: "Grace Hopper", email: "grace@example.com" },
        line_items: [
          { title: "Nanosecond wire (30cm)", quantity: 5, price: "4.50" },
          { title: "COBOL field guide", quantity: 1, price: "39.00" },
          { title: "Bug jar", quantity: 1, price: "28.00" },
        ],
      }),
    ],
    check(body) {
      const pdf = body.subarray(0, 5).toString() === "%PDF-" && body.subarray(-6).toString().includes("%%EOF");
      return pdf ? { ok: true, detail: `PDF ${body.toString("latin1").match(/^%PDF-([\d.]+)/)?.[1]}` } : { ok: false, detail: "Not a PDF" };
    },
  },
  {
    id: "latency-chart",
    title: "Uptime checks → SVG chart",
    summary:
      "Plots check latency with failures marked and the p95 in the corner. No built-ins needed: a transformation can return a string body with any content type.",
    modules: [],
    inputs: [checks("api.example.com", 3, 0), checks("checkout.example.com", 11, 4)],
    check(body) {
      const svg = /^<svg[\s>]/.test(body.toString("utf8").trimStart());
      return svg ? { ok: true, detail: "SVG document" } : { ok: false, detail: "Not an SVG document" };
    },
  },
  {
    id: "sign-hmac",
    title: "Event → signed request",
    summary:
      "Adds an HMAC-SHA256 signature over the timestamp and body, using a secret from the transformation's environment variables. This server verifies it.",
    modules: ["node:crypto"],
    get env() {
      return { HOOKDECK_WEBHOOK_SECRET: webhookSecret() };
    },
    inputs: [
      json("user.created", { type: "user.created", user: { id: "usr_2041", email: "ada@example.com", plan: "pro" } }),
      json("invoice.paid", { type: "invoice.paid", invoice: { id: "in_88412", amount_paid: 4900, currency: "usd" } }),
    ],
    check(body, headers) {
      const value = header(headers, "x-signature");
      const match = value?.match(/^t=(\d+),v1=([a-f0-9]{64})$/);
      if (!match?.[1]) return { ok: false, detail: "No x-signature header" };
      const expected = createHmac("sha256", webhookSecret()).update(`${match[1]}.${body.toString("utf8")}`).digest("hex");
      return expected === match[2]
        ? { ok: true, detail: "Signature verified" }
        : { ok: false, detail: "Signature does not match the body received" };
    },
  },
  {
    id: "gunzip-batch",
    title: "Gzipped batch → JSON",
    summary:
      "The reverse direction: a gzip-compressed NDJSON batch arrives as bytes, and the transformation decompresses it into JSON the destination can read.",
    modules: ["node:zlib"],
    inputs: [batch(5), batch(12)],
    check(body, _headers, input) {
      try {
        const parsed = JSON.parse(body.toString("utf8")) as { count?: number };
        const expected = input.display?.trim().split("\n").length;
        return parsed.count === expected
          ? { ok: true, detail: `${parsed.count} events as JSON` }
          : { ok: false, detail: `Expected ${expected} events, got ${parsed.count}` };
      } catch {
        return { ok: false, detail: "Not JSON" };
      }
    },
  },
];

import * as fs from 'fs';
import * as path from 'path';
import { CallLog, emptyLog } from './call-log';
import { Chronicle, emptyChronicle } from './chronicle';

// DATA_DIR lets a second instance (a test run) keep its files apart from the main one
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const LOG_FILE = path.join(DATA_DIR, 'call-log.json');
export const DELIVERIES_FILE = path.join(DATA_DIR, 'deliveries.jsonl');

export function loadLog(): CallLog {
  try {
    return JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
  } catch {
    return emptyLog();
  }
}

/** Writes a file so a crash mid-write never leaves half a file: write a temporary file next to it, then rename it over. */
export function writeFileAtomic(file: string, contents: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, file);
}

export function saveLog(log: CallLog): void {
  writeFileAtomic(LOG_FILE, JSON.stringify(log, null, 2));
}

const CHRONICLE_FILE = path.join(DATA_DIR, 'chronicle.json');

export function loadChronicle(): Chronicle {
  try {
    return JSON.parse(fs.readFileSync(CHRONICLE_FILE, 'utf-8'));
  } catch {
    return emptyChronicle();
  }
}

export function saveChronicle(chronicle: Chronicle): void {
  writeFileAtomic(CHRONICLE_FILE, JSON.stringify(chronicle, null, 2));
}

export interface Delivery {
  received_at: string;
  event_id?: string;
  event?: string;
  verified: boolean;
  duplicate: boolean;
  error?: string;
  // Kept so a delivery can be replayed through a verifier later (see README)
  headers: Record<string, string | string[] | undefined>;
  body_base64: string;
}

/** Headers that carry a credential: the LiveKit token in `Authorization` is a bearer credential until it expires, so it is never written to disk. */
const SENSITIVE_HEADERS = new Set(['authorization', 'proxy-authorization', 'cookie', 'x-api-key']);
export const redactHeaders = (headers: Delivery['headers']): Delivery['headers'] =>
  Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, SENSITIVE_HEADERS.has(name.toLowerCase()) ? '[redacted]' : value]));

/** The file keeps the most recent deliveries: past twice this, it is rewritten without the oldest. */
export const MAX_DELIVERIES = 500;

let appended = 0;
export function recordDelivery(delivery: Delivery): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.appendFileSync(DELIVERIES_FILE, JSON.stringify({ ...delivery, headers: redactHeaders(delivery.headers) }) + '\n');
  // Checking the length reads the file, so only every 100 deliveries
  if (++appended % 100 === 0) trimDeliveries();
}

/** Keeps the last `max` deliveries once the file holds more than twice that. */
export function trimDeliveries(file = DELIVERIES_FILE, max = MAX_DELIVERIES): void {
  try {
    const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean);
    if (lines.length > max * 2) writeFileAtomic(file, lines.slice(-max).join('\n') + '\n');
  } catch { /* no file yet */ }
}

const redactLine = (line: string) => {
  try { const d = JSON.parse(line) as Delivery; return JSON.stringify({ ...d, headers: redactHeaders(d.headers || {}) }); } catch { return line; }
};

/** At startup: rewrite the file with credentials redacted (a file from before redaction held the tokens) and capped. */
export function scrubDeliveries(file = DELIVERIES_FILE): void {
  try {
    const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean);
    writeFileAtomic(file, lines.slice(-MAX_DELIVERIES).map(redactLine).join('\n') + '\n');
  } catch { /* no file yet */ }
}

export function readDeliveries(limit = 50): Omit<Delivery, 'headers' | 'body_base64'>[] {
  try {
    const lines = fs.readFileSync(DELIVERIES_FILE, 'utf-8').trim().split('\n').filter(Boolean);
    return lines.slice(-limit).reverse().map((l) => {
      const { headers, body_base64, ...rest } = JSON.parse(l) as Delivery;
      return rest;
    });
  } catch {
    return [];
  }
}

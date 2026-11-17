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

export function saveLog(log: CallLog): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
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
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CHRONICLE_FILE, JSON.stringify(chronicle, null, 2));
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

export function recordDelivery(delivery: Delivery): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.appendFileSync(DELIVERIES_FILE, JSON.stringify(delivery) + '\n');
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

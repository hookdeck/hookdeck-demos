import { requireArg } from './utils/args';

async function main() {
  const mode = process.argv[2] || 'payload'; // 'payload' | 'timestamp'
  const SOURCE_URL = requireArg('--url');

  const basePayload = {
    type: 'demo.product.updated',
    data: { sku: 'SKU-123', price: 199, stock: 50 }
  };

  let payloadA, payloadB;

  if (mode === 'payload') {
    // Identical payloads including event_id and timestamp
    const sharedId = `evt_${Date.now()}`;
    const sharedTimestamp = new Date().toISOString();
    payloadA = { ...basePayload, event_id: sharedId, timestamp: sharedTimestamp };
    payloadB = { ...basePayload, event_id: sharedId, timestamp: sharedTimestamp };
  } else if (mode === 'timestamp') {
    // Same payload but timestamp +1 second
    const eventId = `evt_${Date.now()}`;
    const baseTimestamp = new Date();
    const timestampA = baseTimestamp.toISOString();
    const timestampB = new Date(baseTimestamp.getTime() + 1000).toISOString(); // +1 second
    payloadA = { ...basePayload, event_id: eventId, timestamp: timestampA };
    payloadB = { ...basePayload, event_id: eventId, timestamp: timestampB };
  } else {
    throw new Error(`Unknown mode: ${mode}. Use 'payload' or 'timestamp'`);
  }

  console.log(`sending duplicates in mode=${mode}`);
  await post(payloadA);
  await post(payloadB);

  async function post(body: any) {
    const res = await fetch(SOURCE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) console.error('non-2xx from source:', res.status, await res.text());
  }
}

main().catch(console.error);
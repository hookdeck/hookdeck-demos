import { getArg, requireArg } from './utils/args';

async function main() {
  const SOURCE_URL = requireArg('--url');
  const count = parseInt(getArg('--count', '25')!, 10);
  const dupEvery = parseInt(getArg('--dupePercent', '50')!, 10);

  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const reuse = Math.random() * 100 < dupEvery && ids.length > 0;
    const event_id = reuse ? ids[Math.floor(Math.random() * ids.length)] : `evt_${Date.now()}_${i}`;
    if (!reuse) ids.push(event_id);

    const body = {
      event_id,
      type: 'demo.invoice.updated',
      data: { invoiceNo: 1000 + (i % 7), amount: 15 + i }
    };

    await post(body);
  }
  console.log(`sent ${count} events with ~${dupEvery}% duplicates`);

  async function post(body: any) {
    const res = await fetch(SOURCE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) console.error('non-2xx:', res.status, await res.text());
  }
}

main().catch(console.error);
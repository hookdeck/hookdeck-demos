import { requireArg } from './utils/args';

async function main() {
  const SOURCE_URL = requireArg('--url');
  const payload = {
    event_id: `evt_${Date.now()}`,
    type: 'demo.order.created',
    data: { orderId: 123, customerId: 456, amount: 42.99 }
  };

  await post(payload);
  console.log('sent one:', payload.event_id);

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
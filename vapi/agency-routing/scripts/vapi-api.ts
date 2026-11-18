/** Minimal Vapi REST client (https://docs.vapi.ai/api-reference). */
const BASE = process.env.VAPI_API_BASE || 'https://api.vapi.ai';

export function requireVapiKey(): string {
  const key = process.env.VAPI_API_KEY;
  if (!key || key.startsWith('your_')) {
    console.error('VAPI_API_KEY is not set. Add your Vapi private API key to .env');
    console.error('(Vapi dashboard: API Keys -> Private API Key).');
    process.exit(1);
  }
  return key;
}

export async function vapi(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${requireVapiKey()}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Vapi ${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}

/**
 * Vapi Live Call Control: POST a command to the call's monitor.controlUrl.
 * https://docs.vapi.ai/calls/call-features
 */
export type ControlCommand =
  | { type: 'say'; content: string; endCallAfterSpoken?: boolean }
  | { type: 'add-message'; message: { role: 'system' | 'user' | 'assistant'; content: string }; triggerResponseEnabled?: boolean };

/**
 * The controlUrl arrives in a webhook body, so only POST to a Vapi host over https. For the offline test and
 * `npm run simulate`, which use a local stand-in, set ALLOW_LOCAL_CONTROL_URL=true to also allow http://localhost.
 * Throws when the URL is not acceptable.
 */
export function assertControlUrl(control_url: string): void {
  let url: URL;
  try { url = new URL(control_url); } catch { throw new Error('controlUrl is not a valid URL'); }
  const local_ok = process.env.ALLOW_LOCAL_CONTROL_URL === 'true' && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  if (local_ok) return;
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.vapi.ai') || url.username || url.password) {
    throw new Error(`controlUrl host ${url.hostname || '(none)'} is not an https *.vapi.ai URL`);
  }
}

/** Resolves with the HTTP status when Vapi accepts the command; throws (with `status`) otherwise. */
export async function sendToCall(control_url: string, command: ControlCommand): Promise<number> {
  const res = await fetch(control_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw Object.assign(new Error(`controlUrl responded ${res.status}: ${(await res.text()).slice(0, 200)}`), { status: res.status });
  return res.status;
}

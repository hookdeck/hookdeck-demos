/**
 * Vapi Live Call Control: POST a command to the call's monitor.controlUrl.
 * https://docs.vapi.ai/calls/call-features
 */
export type ControlCommand =
  | { type: 'say'; content: string; endCallAfterSpoken?: boolean }
  | { type: 'add-message'; message: { role: 'system' | 'user' | 'assistant'; content: string }; triggerResponseEnabled?: boolean };

/** Resolves with the HTTP status when Vapi accepts the command; throws (with `status`) otherwise. */
export async function sendToCall(control_url: string, command: ControlCommand): Promise<number> {
  const res = await fetch(control_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  if (!res.ok) throw Object.assign(new Error(`controlUrl responded ${res.status}: ${(await res.text()).slice(0, 200)}`), { status: res.status });
  return res.status;
}

/**
 * Vapi Live Call Control: POST a command to the call's monitor.controlUrl.
 * https://docs.vapi.ai/calls/call-features
 */
export type ControlCommand =
  | { type: 'say'; content: string; endCallAfterSpoken?: boolean }
  | { type: 'add-message'; message: { role: 'system' | 'user' | 'assistant'; content: string }; triggerResponseEnabled?: boolean };

export async function sendToCall(control_url: string, command: ControlCommand): Promise<void> {
  const res = await fetch(control_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  if (!res.ok) throw new Error(`controlUrl responded ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

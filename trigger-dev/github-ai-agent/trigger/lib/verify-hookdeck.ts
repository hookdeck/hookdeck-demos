/**
 * Hookdeck event verification utility.
 *
 * The trigger-wrapper transformation injects a _hookdeck metadata object
 * into every payload with the verification status from Hookdeck's headers.
 * This utility checks that metadata before any task processing begins.
 *
 * Verification chain:
 * 1. Hookdeck source verification validates the GitHub HMAC signature at ingress
 * 2. Hookdeck destination auth (Bearer token) authenticates to the Trigger.dev API
 * 3. This check confirms the event actually passed source verification
 */

export interface HookdeckMeta {
  verified: boolean;
  signature?: string;
}

export interface HookdeckPayload {
  _hookdeck?: HookdeckMeta;
  [key: string]: unknown;
}

export function verifyHookdeckEvent(payload: HookdeckPayload): void {
  if (!payload._hookdeck) {
    throw new Error(
      "Missing _hookdeck metadata. Event did not come through the trigger-wrapper transformation."
    );
  }

  if (!payload._hookdeck.verified) {
    throw new Error(
      "Event failed Hookdeck source verification. The webhook signature was invalid."
    );
  }
}

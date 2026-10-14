/** The MCP Events wire shapes this demo uses (webhook delivery mode). */

export interface McpEvent {
  eventId: string;
  name: string;
  timestamp: string;
  data: Record<string, unknown>;
  cursor: string | null;
}

/** Bodies with a top-level `type` are control envelopes, not events. */
export type ControlEnvelope =
  | { type: 'verification'; challenge: string }
  | { type: 'gap'; cursor: string }
  | { type: 'terminated'; error: { code: number; message: string; data?: unknown } };

export interface SubscribeResult {
  id: string;
  refreshBefore: string | null;
  cursor: string | null;
  truncated: boolean;
  deliveryStatus?: { active: boolean; lastDeliveryAt?: string | null; lastError?: string | null };
}

export const SUBSCRIPTION_HEADER = 'x-mcp-subscription-id';

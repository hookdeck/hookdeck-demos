import { ProtocolError } from '@modelcontextprotocol/server';

/**
 * Error codes as OpenAI's MCP Events guide (and the design sketch) use them.
 * SEP-3415 renumbers these to -32023..-32027; this stand-in follows the codes
 * ChatGPT-facing servers use today. See the README.
 */
export const EventsErrorCode = {
  InvalidParams: -32602,
  NotFound: -32011,
  Forbidden: -32012,
  Unsupported: -32014,
  CallbackEndpointError: -32015,
} as const;

export type CallbackFailureReason = 'connection_refused' | 'timeout' | 'tls_error' | 'http_4xx' | 'http_5xx' | 'challenge_failed';

export const invalidParams = (message: string, data?: Record<string, unknown>) =>
  new ProtocolError(EventsErrorCode.InvalidParams, message, data);

export const notFound = (message: string) => new ProtocolError(EventsErrorCode.NotFound, message, { kind: 'event' });

export const forbidden = () => new ProtocolError(EventsErrorCode.Forbidden, 'An authenticated principal is required');

export const unsupported = (feature: string, value: unknown) =>
  new ProtocolError(EventsErrorCode.Unsupported, `Unsupported ${feature}`, { feature, value });

export const callbackEndpointError = (reason: CallbackFailureReason) =>
  new ProtocolError(EventsErrorCode.CallbackEndpointError, 'CallbackEndpointError', { reason });

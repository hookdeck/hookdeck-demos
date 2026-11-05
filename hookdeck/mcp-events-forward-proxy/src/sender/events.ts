import * as z from 'zod';

/**
 * The stand-in sender's event catalog: one event type, `error.detected`, from
 * the MCP server of a pretend error-tracking service. It fires the first time the service sees
 * a new error in an application, with enough detail (the error, where it was
 * thrown, the release) for an agent to start investigating and propose a fix.
 * Any MCP server that supports MCP Events could take its place; the agent and
 * Event Gateway don't depend on the event type.
 */

export const ERROR_DETECTED = 'error.detected';

export const LEVELS = ['warning', 'error', 'fatal'] as const;
export type Level = (typeof LEVELS)[number];

export const errorArguments = z
  .object({
    minLevel: z.enum(LEVELS).optional(),
    environment: z.string().optional(),
  })
  .strict();

export type ErrorArguments = z.infer<typeof errorArguments>;

export interface DetectedError {
  errorId: string;
  title: string;
  /** Where it was thrown: file and function. */
  culprit: string;
  level: Level;
  environment: string;
  release: string;
  firstSeen: string;
  occurrences: number;
}

export const eventCatalog = [
  {
    name: ERROR_DETECTED,
    description: 'Fires the first time a new error is seen. Optionally only errors at or above a level, or in one environment.',
    delivery: ['webhook'],
    inputSchema: {
      type: 'object',
      properties: {
        minLevel: { type: 'string', enum: [...LEVELS], description: 'Only deliver errors at least this severe (fatal is the most severe).' },
        environment: { type: 'string', description: 'Only deliver errors from this environment, such as production.' },
      },
      additionalProperties: false,
    },
    payloadSchema: {
      type: 'object',
      properties: {
        errorId: { type: 'string' },
        title: { type: 'string' },
        culprit: { type: 'string' },
        level: { type: 'string', enum: [...LEVELS] },
        environment: { type: 'string' },
        release: { type: 'string' },
        firstSeen: { type: 'string', format: 'date-time' },
        occurrences: { type: 'integer' },
      },
      required: ['errorId', 'title', 'culprit', 'level', 'environment', 'release', 'firstSeen', 'occurrences'],
      additionalProperties: false,
    },
  },
];

/** Errors the demo cycles through when it isn't given one. Illustrative. */
export const SAMPLE_ERRORS: Array<Pick<DetectedError, 'title' | 'culprit' | 'level'>> = [
  { title: "TypeError: Cannot read properties of undefined (reading 'total')", culprit: 'src/checkout/cart.ts in applyDiscount', level: 'error' },
  { title: 'RangeError: Invalid time value', culprit: 'src/billing/invoice.ts in formatDueDate', level: 'error' },
  { title: 'Error: connect ECONNREFUSED 10.0.4.12:5432', culprit: 'src/db/pool.ts in acquire', level: 'fatal' },
  { title: "TypeError: Cannot read properties of null (reading 'email')", culprit: 'src/settings/notifications.ts in loadPreferences', level: 'error' },
];

const rank = (level: Level) => LEVELS.indexOf(level);

/** True when a subscription's arguments ask for this error. */
export function matchesArguments(args: ErrorArguments, error: DetectedError): boolean {
  return (args.minLevel === undefined || rank(error.level) >= rank(args.minLevel)) && (args.environment === undefined || args.environment === error.environment);
}

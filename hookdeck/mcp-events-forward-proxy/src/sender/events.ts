import * as z from 'zod';

/**
 * The stand-in sender's event catalog: one event type, `incident.created`, from
 * a pretend monitoring service. Any MCP server that supports MCP Events could
 * take its place; the agent and Event Gateway don't depend on the event type.
 */

export const INCIDENT_CREATED = 'incident.created';

export const SEVERITIES = ['P1', 'P2', 'P3'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const incidentArguments = z
  .object({
    minSeverity: z.enum(SEVERITIES).optional(),
  })
  .strict();

export type IncidentArguments = z.infer<typeof incidentArguments>;

export interface Incident {
  incidentId: string;
  severity: Severity;
  title: string;
  openedAt: string;
}

export const eventCatalog = [
  {
    name: INCIDENT_CREATED,
    description: 'Fires when an incident is opened. Optionally only incidents at or above a severity (P1 is the most severe).',
    delivery: ['webhook'],
    inputSchema: {
      type: 'object',
      properties: {
        minSeverity: { type: 'string', enum: [...SEVERITIES], description: 'Only deliver incidents at least this severe.' },
      },
      additionalProperties: false,
    },
    payloadSchema: {
      type: 'object',
      properties: {
        incidentId: { type: 'string' },
        severity: { type: 'string', enum: [...SEVERITIES] },
        title: { type: 'string' },
        openedAt: { type: 'string', format: 'date-time' },
      },
      required: ['incidentId', 'severity', 'title', 'openedAt'],
      additionalProperties: false,
    },
  },
];

const rank = (severity: Severity) => SEVERITIES.indexOf(severity);

/** True when a subscription's arguments ask for this incident. */
export function matchesArguments(args: IncidentArguments, incident: Incident): boolean {
  return args.minSeverity === undefined || rank(incident.severity) <= rank(args.minSeverity);
}

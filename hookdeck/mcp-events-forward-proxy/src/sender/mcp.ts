import { McpServer, type ServerCapabilities } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { eventCatalog } from './events.js';
import type { Subscriptions } from './subscriptions.js';

/**
 * Builds the MCP server for one request (the 2026-07-28 revision is stateless,
 * so the SDK asks for a fresh instance per request). The SDK has no MCP Events
 * support, so the `events` capability and the `events/*` methods are registered
 * by hand, as in hookdeck/mcp-events-outpost-demo.
 */
export function buildMcpServer(subscriptions: Subscriptions, principal: string | undefined): McpServer {
  // `events` isn't in the SDK's ServerCapabilities type. Top-level placement is
  // what ChatGPT reads; SEP-3415 moves it under `extensions`.
  const capabilities = { events: {} } as ServerCapabilities;
  const mcpServer = new McpServer({ name: 'mcp-events-stand-in-sender', version: '1.0.0' }, { capabilities });

  const { server } = mcpServer;
  const anyParams = z.record(z.string(), z.unknown());
  server.setRequestHandler('events/list', { params: anyParams.optional() }, async () => ({ events: eventCatalog }));
  server.setRequestHandler('events/subscribe', { params: anyParams }, async (params) => ({
    ...(await subscriptions.subscribe(principal, params)),
  }));
  server.setRequestHandler('events/unsubscribe', { params: anyParams }, async (params) => subscriptions.unsubscribe(principal, params));

  return mcpServer;
}

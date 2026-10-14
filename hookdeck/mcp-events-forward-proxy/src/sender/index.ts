import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { loadEnv, numberEnv } from '../shared/env.js';
import { SEVERITIES, type Severity } from './events.js';
import { buildMcpServer } from './mcp.js';
import { Subscriptions } from './subscriptions.js';

/*
 * A stand-in MCP server that sends MCP Events (webhook delivery mode). It plays
 * the part of any third-party MCP server. One bearer token stands for one
 * principal; real servers use OAuth.
 */

loadEnv();

const log = (message: string) => console.log(`[sender] ${message}`);
const port = numberEnv('PORT', numberEnv('SENDER_PORT', 3100));
const token = process.env.SENDER_TOKEN || 'demo-sender-token';
if (!process.env.SENDER_TOKEN) log('SENDER_TOKEN not set; using the demo default. Set one before exposing the sender publicly.');

const subscriptions = new Subscriptions(
  {
    defaultTtlMs: numberEnv('SENDER_DEFAULT_TTL_MS', 10 * 60 * 1000),
    minTtlMs: numberEnv('SENDER_MIN_TTL_MS', 60 * 1000),
    maxTtlMs: numberEnv('SENDER_MAX_TTL_MS', 24 * 60 * 60 * 1000),
    allowHttpCallbacks: process.env.SENDER_ALLOW_HTTP_CALLBACKS === 'true',
    timeoutMs: numberEnv('SENDER_TIMEOUT_MS', 10_000),
    retryDelaysMs: (process.env.SENDER_RETRY_DELAYS_MS ?? '2000,5000').split(',').filter(Boolean).map(Number),
    rotationGraceMs: numberEnv('SENDER_ROTATION_GRACE_MS', 5 * 60 * 1000),
  },
  log,
);

const mcp = toNodeHandler(createMcpHandler((ctx) => buildMcpServer(subscriptions, ctx.authInfo?.clientId)));

const authorized = (req: http.IncomingMessage) => {
  const presented = Buffer.from(/^Bearer (.+)$/i.exec(req.headers.authorization ?? '')?.[1] ?? '');
  const expected = Buffer.from(token);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
};

const json = (res: http.ServerResponse, status: number, body: unknown) =>
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return chunks.length ? (JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>) : {};
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (pathname === '/healthz') return json(res, 200, { ok: true });
    if (!authorized(req)) return res.writeHead(401, { 'WWW-Authenticate': 'Bearer' }).end();

    if (pathname === '/mcp') {
      (req as http.IncomingMessage & { auth?: unknown }).auth = { token, clientId: 'demo-principal', scopes: [] };
      return await mcp(req, res);
    }
    if (pathname === '/demo/incidents' && req.method === 'POST') {
      const input = await readJson(req);
      const severity = SEVERITIES.includes(input.severity as Severity) ? (input.severity as Severity) : undefined;
      return json(res, 201, await subscriptions.emit({
        severity,
        title: typeof input.title === 'string' ? input.title : undefined,
        duplicate: input.duplicate === true,
        badSignature: input.badSignature === true,
      }));
    }
    if (pathname === '/demo/subscriptions' && req.method === 'GET') return json(res, 200, subscriptions.list());
    json(res, 404, { error: 'not found' });
  } catch (error) {
    log(`error on ${pathname}: ${(error as Error).message}`);
    if (!res.headersSent) json(res, 500, { error: (error as Error).message });
  }
});

const sweeper = setInterval(() => subscriptions.sweep(), 30_000);
sweeper.unref();

server.listen(port, () => {
  log(`MCP endpoint:    http://localhost:${port}/mcp  (Authorization: Bearer <SENDER_TOKEN>)`);
  log(`Open incidents:  POST http://localhost:${port}/demo/incidents  (or: npm run emit)`);
});

const shutdown = () => {
  server.closeAllConnections();
  server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

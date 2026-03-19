#!/usr/bin/env node

/**
 * github_webhook_noise.ts
 * 
 * Send a burst of GitHub-like webhook events to a given URL so you can demo:
 *   1) Noisy local development
 *   2) Filtering down to the events you care about with Hookdeck transient filters
 * 
 * Usage:
 *   npm run webhooks -- --url http://localhost:3000/webhooks/github \
 *     --secret your_webhook_secret \
 *     --sleep 1.5
 * 
 * Notes:
 * - If --secret is provided, the script signs payloads using HMAC SHA-256 and sets
 *   'X-Hub-Signature-256' like GitHub does.
 * - Default order (with short sleeps between each):
 *     push -> issues.opened -> pull_request.opened -> issue_comment.created
 *     -> pull_request.labeled -> star.created -> pull_request.closed -> issues.closed
 * 
 * You can pair this with Hookdeck CLI:
 *   # Noisy stream
 *   hookdeck listen 3000 github
 * 
 *   # Filter to only pull_request.opened
 *   hookdeck listen 3000 github \
 *     --filter-headers '{"x-github-event": "pull_request"}' \
 *     --filter-body '{"action": "opened"}'
 */

import { createHmac, randomUUID } from 'crypto';

interface Args {
  url: string;
  owner: string;
  name: string;
  login: string;
  secret: string | null;
  sleep: number;
  timeout: number;
  ua: string;
  verbose: boolean;
  loops: number;
}

type Payload = Record<string, any>;

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function sign(secret: string, body: string): string {
  const mac = createHmac('sha256', secret);
  mac.update(body);
  return 'sha256=' + mac.digest('hex');
}

function headers(event: string, body: string, secret: string | null, ua: string): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': ua,
    'X-GitHub-Event': event,
    'X-GitHub-Delivery': randomUUID(),
    // Optional, but commonly present in real deliveries
    'X-GitHub-Hook-ID': '0000000000',
    'X-GitHub-Hook-Installation-Target-ID': '0',
    'X-GitHub-Hook-Installation-Target-Type': 'repository',
  };
  if (secret) {
    h['X-Hub-Signature-256'] = sign(secret, body);
  }
  return h;
}

async function post(
  url: string,
  event: string,
  payload: Payload,
  secret: string | null,
  timeout: number,
  verbose: boolean,
  ua: string
): Promise<void> {
  const bodyStr = JSON.stringify(payload, null, 0);
  const hdrs = headers(event, bodyStr, secret, ua);
  
  if (verbose) {
    const now = new Date();
    const timeStr = now.toTimeString().substring(0, 8);
    console.log(`[${timeStr}] -> POST ${event} (${bodyStr.length} bytes)`);
  }
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout * 1000);
    
    const resp = await fetch(url, {
      method: 'POST',
      headers: hdrs,
      body: bodyStr,
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (verbose) {
      console.log(`   <- ${resp.status}`);
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(`   !! request error: ${error.message}`);
    } else {
      console.error(`   !! request error: ${error}`);
    }
  }
}

function repoBlock(owner: string, name: string): Payload {
  return {
    id: 1,
    name: name,
    full_name: `${owner}/${name}`,
    private: false,
    html_url: `https://github.com/${owner}/${name}`,
  };
}

function senderBlock(login: string): Payload {
  return {
    login: login,
    id: 1000,
    html_url: `https://github.com/${login}`,
    type: 'User',
    site_admin: false,
  };
}

function payloadPush(owner: string, name: string, login: string, branch: string): Payload {
  return {
    ref: `refs/heads/${branch}`,
    before: '0000000000000000000000000000000000000000',
    after: '1111111111111111111111111111111111111111',
    repository: repoBlock(owner, name),
    pusher: { name: login, email: `${login}@example.com` },
    sender: senderBlock(login),
    commits: [
      {
        id: '1111111111111111111111111111111111111111',
        message: 'chore(demo): add file',
        timestamp: nowIso(),
        url: `https://github.com/${owner}/${name}/commit/1111`,
        author: { name: login, email: `${login}@example.com` },
      },
    ],
    head_commit: {
      id: '1111111111111111111111111111111111111111',
      message: 'chore(demo): add file',
      timestamp: nowIso(),
      url: `https://github.com/${owner}/${name}/commit/1111`,
      author: { name: login, email: `${login}@example.com` },
    },
    created: true,
    deleted: false,
    forced: false,
    compare: `https://github.com/${owner}/${name}/compare/0000...1111`,
  };
}

function payloadIssue(owner: string, name: string, login: string, number: number, action: string): Payload {
  return {
    action: action,
    issue: {
      number: number,
      title: 'Hookdeck demo issue',
      state: action === 'opened' ? 'open' : 'closed',
      body: 'Demo issue body for webhook noise',
      html_url: `https://github.com/${owner}/${name}/issues/${number}`,
      user: senderBlock(login),
      created_at: nowIso(),
      updated_at: nowIso(),
      closed_at: action === 'opened' ? null : nowIso(),
    },
    repository: repoBlock(owner, name),
    sender: senderBlock(login),
  };
}

function payloadPr(
  owner: string,
  name: string,
  login: string,
  number: number,
  action: string,
  base: string = 'main',
  head: string = 'demo/noise'
): Payload {
  return {
    action: action,
    number: number,
    pull_request: {
      number: number,
      state: action === 'opened' || action === 'labeled' ? 'open' : 'closed',
      title: 'Hookdeck demo PR',
      body: 'Webhook demo PR body',
      html_url: `https://github.com/${owner}/${name}/pull/${number}`,
      base: { ref: base },
      head: { ref: head },
      user: senderBlock(login),
      created_at: nowIso(),
      updated_at: nowIso(),
      closed_at: action === 'opened' || action === 'labeled' ? null : nowIso(),
      merged: false,
      labels: action === 'labeled' ? [{ name: 'hookdeck-demo' }] : [],
    },
    repository: repoBlock(owner, name),
    sender: senderBlock(login),
  };
}

function payloadIssueComment(owner: string, name: string, login: string, number: number): Payload {
  return {
    action: 'created',
    issue: {
      number: number,
      title: 'Hookdeck demo PR',
      html_url: `https://github.com/${owner}/${name}/issues/${number}`,
      pull_request: { html_url: `https://github.com/${owner}/${name}/pull/${number}` },
    },
    comment: {
      body: 'Hookdeck demo comment',
      user: senderBlock(login),
      created_at: nowIso(),
    },
    repository: repoBlock(owner, name),
    sender: senderBlock(login),
  };
}

function payloadStar(owner: string, name: string, login: string, action: string = 'created'): Payload {
  return {
    action: action,
    starred_at: nowIso(),
    repository: repoBlock(owner, name),
    sender: senderBlock(login),
  };
}

async function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

async function runSequence(
  url: string,
  secret: string | null,
  owner: string,
  name: string,
  login: string,
  sleepSecs: number,
  timeout: number,
  ua: string,
  verbose: boolean
): Promise<void> {
  // 1) push
  await post(url, 'push', payloadPush(owner, name, login, 'demo/noise'), secret, timeout, verbose, ua);
  await sleep(sleepSecs);

  // 2) issues.opened
  const issueNo = 101;
  await post(url, 'issues', payloadIssue(owner, name, login, issueNo, 'opened'), secret, timeout, verbose, ua);
  await sleep(sleepSecs);

  // 3) pull_request.opened
  const prNo = 7;
  await post(url, 'pull_request', payloadPr(owner, name, login, prNo, 'opened'), secret, timeout, verbose, ua);
  await sleep(sleepSecs);

  // 4) issue_comment.created (on the PR thread)
  await post(url, 'issue_comment', payloadIssueComment(owner, name, login, prNo), secret, timeout, verbose, ua);
  await sleep(sleepSecs);

  // 5) pull_request.labeled
  await post(url, 'pull_request', payloadPr(owner, name, login, prNo, 'labeled'), secret, timeout, verbose, ua);
  await sleep(sleepSecs);

  // 6) star.created
  await post(url, 'star', payloadStar(owner, name, login, 'created'), secret, timeout, verbose, ua);
  await sleep(sleepSecs);

  // 7) pull_request.closed
  await post(url, 'pull_request', payloadPr(owner, name, login, prNo, 'closed'), secret, timeout, verbose, ua);
  await sleep(sleepSecs);

  // 8) issues.closed
  await post(url, 'issues', payloadIssue(owner, name, login, issueNo, 'closed'), secret, timeout, verbose, ua);
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const parsed: Partial<Args> = {
    owner: 'hookdeck',
    name: 'cli-demo',
    login: 'demo-user',
    secret: null,
    sleep: 1.25,
    timeout: 5.0,
    ua: 'GitHub-Hookshot/000000',
    verbose: false,
    loops: 1,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--url':
        parsed.url = args[++i];
        break;
      case '--owner':
        parsed.owner = args[++i];
        break;
      case '--name':
        parsed.name = args[++i];
        break;
      case '--login':
        parsed.login = args[++i];
        break;
      case '--secret':
        parsed.secret = args[++i];
        break;
      case '--sleep':
        parsed.sleep = parseFloat(args[++i]);
        break;
      case '--timeout':
        parsed.timeout = parseFloat(args[++i]);
        break;
      case '--ua':
        parsed.ua = args[++i];
        break;
      case '--loops':
        parsed.loops = Math.max(1, parseInt(args[++i], 10));
        break;
      case '--verbose':
        parsed.verbose = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        console.error(`Unknown argument: ${arg}`);
        printHelp();
        process.exit(1);
    }
  }

  if (!parsed.url) {
    console.error('Error: --url is required');
    printHelp();
    process.exit(1);
  }

  return parsed as Args;
}

function printHelp(): void {
  console.log(`
Usage: npm run webhooks -- --url <url> [options]

Send GitHub-like webhook noise to a URL.

Required:
  --url <url>           Target URL to POST webhooks to

Optional:
  --owner <owner>       Repository owner value (default: hookdeck)
  --name <name>         Repository name value (default: cli-demo)
  --login <login>       Sender login value (default: demo-user)
  --secret <secret>     Webhook secret for HMAC SHA-256 signing
  --sleep <seconds>     Seconds to sleep between events (default: 1.25)
  --timeout <seconds>   HTTP timeout for each request (default: 5.0)
  --ua <user-agent>     User-Agent to send (default: GitHub-Hookshot/000000)
  --loops <number>      Number of times to repeat the webhook sequence (default: 1, min: 1)
  --verbose             Print per-request status
  --help, -h            Show this help message
`);
}

async function main(): Promise<void> {
  const args = parseArgs();
  
  for (let i = 0; i < args.loops; i++) {
    if (args.loops > 1) {
      console.log(`\n=== Loop ${i + 1} of ${args.loops} ===\n`);
    }
    
    await runSequence(
      args.url,
      args.secret,
      args.owner,
      args.name,
      args.login,
      args.sleep,
      args.timeout,
      args.ua,
      args.verbose
    );
    
    // Add a small delay between loops (except after the last one)
    if (i < args.loops - 1) {
      await sleep(args.sleep);
    }
  }
  
  if (args.loops > 1) {
    console.log(`\nCompleted all ${args.loops} loops (${args.loops * 8} total webhooks sent)`);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
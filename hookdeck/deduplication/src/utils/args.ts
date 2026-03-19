export function getArg(flag: string, fallback?: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return fallback;
}

export function requireArg(flag: string, hint?: string): string {
  const v = getArg(flag);
  if (!v) {
    const msg = [`Missing required arg ${flag}.`];
    if (hint) msg.push(hint);
    msg.push(`Example: --url https://events.hookdeck.com/e/src_XXXX`);
    throw new Error(msg.join(' '));
  }
  return v;
}
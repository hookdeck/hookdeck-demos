/**
 * Who the innkeeper already knows. A player who typed a name on the page joins with it as the
 * participant name, so Hester greets them by it and writes it in the ledger without asking. She
 * asks only for players who joined without one: no name, or the placeholder `web-xxxx` identity.
 * Silent bot players (identity `bot-...`) always have a known name.
 */

export interface Guest {
  identity: string;
  name?: string | null;
  bot: boolean;
}

export interface LedgerPlan {
  /** Guests Hester can greet by name and write in the ledger without asking. */
  named: Array<{ identity: string; name: string; bot: boolean }>;
  /** Humans she still has to ask, in the order she meets them. */
  unnamed: string[];
}

/** A name worth greeting: not empty, not the identity, not a generic placeholder. */
export function realName(name: string | null | undefined, identity: string): string | undefined {
  const trimmed = (name ?? '').trim();
  if (!trimmed || trimmed === identity || /^web-[0-9a-f]+$/i.test(trimmed)) return undefined;
  if (['player', 'guest', 'you'].includes(trimmed.toLowerCase())) return undefined;
  return trimmed.slice(0, 24);
}

/** The bot's name comes from its identity: `bot-pixel` is Pixel. */
export const botName = (identity: string) => `${identity.slice(4, 5).toUpperCase()}${identity.slice(5)}`;

/** Splits the guests who are not in the ledger yet into those she can greet by name and those she must ask. */
export function planLedger(guests: Guest[], registered: Set<string>): LedgerPlan {
  const plan: LedgerPlan = { named: [], unnamed: [] };
  for (const guest of guests) {
    if (registered.has(guest.identity)) continue;
    const name = guest.bot ? realName(guest.name, guest.identity) ?? botName(guest.identity) : realName(guest.name, guest.identity);
    if (name) plan.named.push({ identity: guest.identity, name, bot: guest.bot });
    else if (!guest.bot) plan.unnamed.push(guest.identity);
  }
  return plan;
}

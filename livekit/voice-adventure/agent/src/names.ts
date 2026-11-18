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

/**
 * What Hester says when everyone is in the ledger and she goes to fetch Old Bram. It is spoken straight
 * through text-to-speech, in her voice, with no model call: the handoff is code, so it cannot be skipped or
 * leak a tool call into the speech, and the same words cost nothing.
 */
export function fetchLine(greet: string[], bots: string[], variant = 0): string {
  const humans = greet.length === 0 ? '' : greet.length === 1 ? greet[0] : `${greet.slice(0, -1).join(', ')} and ${greet[greet.length - 1]}`;
  const quiet = bots.length === 0 ? '' : ` and your quiet friend${bots.length > 1 ? 's' : ''}, ${bots.join(' and ')}`;
  const welcome = humans ? `Ah, ${humans}, we've been expecting you${quiet}.` : quiet ? `And there's your quiet friend${bots.length > 1 ? 's' : ''}, ${bots.join(' and ')}.` : '';
  const fetch = [
    "Let me fetch Old Bram, love, he's been waiting all evening for a crowd.",
    "Sit by the fire, dears, while I fetch Old Bram. He's been itching for a crowd all night.",
  ][variant % 2];
  return `${welcome} ${fetch}`.trim();
}

/** Hester fetches Bram when everyone is in the ledger and she has just finished speaking (speaking to listening). */
export function shouldFetchBram(old_state: string, new_state: string, pending: boolean, handed_off: boolean): boolean {
  return pending && !handed_off && old_state === 'speaking' && new_state === 'listening';
}

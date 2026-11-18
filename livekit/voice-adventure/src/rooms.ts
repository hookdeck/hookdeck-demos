import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/** The rooms this app creates are named `story-` plus 6 to 8 hex digits, generated here. Nothing else is ever joined, continued or given a bot. */
export const STORY_ROOM = /^story-[0-9a-f]{6,8}$/;
export const newRoomName = (): string => `story-${randomBytes(4).toString('hex')}`;
export const isStoryRoom = (name: unknown): name is string => typeof name === 'string' && STORY_ROOM.test(name);

/** At most this many story rooms are open at once (each runs an agent, which costs Inference credits), and this many Pixel processes. */
export const MAX_ROOMS = Number(process.env.MAX_ROOMS || 6);
export const MAX_PIXELS = Number(process.env.MAX_PIXELS || 4);

export type RoomChoice = { room: string } | { error: string; status: number };

/**
 * Which room a Join goes to. No room asked for: a new one, with a name made here, unless too many are open. A room asked for (an
 * invite link): only an existing, open story room created by this app, so a page can't make the app mint a token for any name.
 */
export function chooseRoom(requested: unknown, open_rooms: string[], max_rooms = MAX_ROOMS, make_name = newRoomName): RoomChoice {
  const open = open_rooms.filter(isStoryRoom);
  if (requested === undefined || requested === null || requested === '') {
    if (open.length >= max_rooms) return { error: `${open.length} stories are already running here. Try again when one has finished.`, status: 429 };
    return { room: make_name() };
  }
  if (!isStoryRoom(requested) || !open.includes(requested)) return { error: 'That story is not open (it may have ended). Ask your friend for a new link, or start your own.', status: 404 };
  return { room: requested };
}

/**
 * The shared secret the agent sends to `/api/scene` and `/api/scene/end`, which spend ingress minutes. Both processes read the same
 * `.env`, so it is derived from the API secret and needs no setting of its own. (A check on the caller's address is not enough: anything
 * on this machine, or a proxy that forwards from localhost, would pass it.)
 */
export const sceneSecret = (api_secret: string): string => createHmac('sha256', api_secret).update('story-scene-call').digest('hex');

export function sceneAuthorized(header: string | undefined, api_secret: string): boolean {
  const expected = Buffer.from(sceneSecret(api_secret));
  const given = Buffer.from(header || '');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

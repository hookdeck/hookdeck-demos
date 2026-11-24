import { isScene, soundtrackUrl, type SceneName } from './soundtracks';

/** The parts of LiveKit's ingress API the keeper uses, so a test can stand in for them. */
export interface IngressLike { ingressId: string; name: string; roomName: string; state?: { status?: number; roomId?: string } }
export interface IngressApi {
  list(room: string): Promise<IngressLike[]>;
  create(options: { name: string; room: string; identity: string; participant_name: string; url: string }): Promise<{ ingressId: string }>;
  remove(id: string): Promise<void>;
}

/** ENDPOINT_BUFFERING and ENDPOINT_PUBLISHING: the file is being played. Anything else (inactive, error, complete) is not. */
export const isPlaying = (ingress: IngressLike): boolean => ingress.state?.status === 1 || ingress.state?.status === 2;

export interface EnsureResult { ok: boolean; kept?: boolean; ingress_id?: string; reason?: string }

/** A soundtrack that ends sooner than this after it started failed: it is not restarted, so a bad file can't loop. */
const MIN_PLAY_MS = 20000;

/**
 * Keeps one soundtrack playing per story room. The files are 180 s long, a scene can run longer, so when a scene's ingress has ended
 * (the `ingress_ended` webhook, or a check on arrival) the same soundtrack is started again. The file is checked with a HEAD request
 * before the ingress is created, so a missing file means "no music" and the caller says so.
 */
export function createSoundtrackKeeper(deps: { ingresses: IngressApi; reachable: (url: string) => Promise<boolean>; room_open: (room: string) => Promise<boolean>; url_of?: (scene: SceneName) => string; now?: () => number }) {
  const wanted = new Map<string, { scene: SceneName; since: number }>();
  const now = deps.now ?? Date.now;
  const url_of = deps.url_of ?? ((scene: SceneName) => soundtrackUrl(scene));

  async function removeScenes(room: string, except?: string): Promise<number> {
    const ours = (await deps.ingresses.list(room)).filter((i) => i.name.startsWith('scene:') && i.ingressId !== except);
    for (const i of ours) await deps.ingresses.remove(i.ingressId).catch(() => undefined);
    return ours.length;
  }

  // One change at a time per room. A late ingress_ended webhook (for example the one for the scene ingress the last scene change
  // deleted) must not run in the middle of a scene change: it would restart the old scene's soundtrack and delete the new one.
  const queues = new Map<string, Promise<unknown>>();
  function serial<T>(room: string, work: () => Promise<T>): Promise<T> {
    const run = (queues.get(room) ?? Promise.resolve()).then(work);
    const tail = run.catch(() => undefined);
    queues.set(room, tail);
    tail.then(() => { if (queues.get(room) === tail) queues.delete(room); });
    return run;
  }

  async function ensureNow(room: string, scene: SceneName): Promise<EnsureResult> {
    const here = (await deps.ingresses.list(room)).filter((i) => i.name.startsWith('scene:'));
    const playing = here.find((i) => i.name === `scene:${scene}` && isPlaying(i));
    if (playing) {
      wanted.set(room, { scene, since: wanted.get(room)?.scene === scene ? wanted.get(room)!.since : now() });
      return { ok: true, kept: true, ingress_id: playing.ingressId };
    }
    // One soundtrack at a time: the previous scene's stops before the next starts
    await removeScenes(room);
    const url = url_of(scene);
    if (!(await deps.reachable(url))) {
      wanted.delete(room);
      return { ok: false, reason: `the soundtrack at ${url} can't be fetched` };
    }
    const ingress = await deps.ingresses.create({ name: `scene:${scene}`, room, identity: `soundtrack-${scene}`, participant_name: `Soundtrack: ${scene}`, url });
    wanted.set(room, { scene, since: now() });
    return { ok: true, ingress_id: ingress.ingressId };
  }

  return {
    wanted,
    /** Makes sure `scene`'s soundtrack is playing in `room`: kept if it already is, otherwise the room's scene ingresses are replaced by a fresh one. */
    ensure: (room: string, scene: SceneName): Promise<EnsureResult> => serial(room, () => ensureNow(room, scene)),
    /** The story ended or the room finished: delete the room's soundtracks and stop wanting one. Returns how many were deleted. */
    stop: (room: string): Promise<number> => serial(room, async () => { wanted.delete(room); return removeScenes(room); }),
    /** An `ingress_ended` webhook for a scene ingress: start the same soundtrack again if the room is still in that scene. */
    onEnded: (room: string, ingress_name: string): Promise<'restarted' | 'ignored'> =>
      // Decided inside the queue: when a late webhook gets its turn, the wanted scene is already the new one
      serial(room, async () => {
        const scene = ingress_name.replace(/^scene:/, '');
        const want = wanted.get(room);
        if (!isScene(scene) || !want || want.scene !== scene) return 'ignored';
        if (now() - want.since < MIN_PLAY_MS) return 'ignored';
        if (!(await deps.room_open(room))) { wanted.delete(room); return 'ignored'; }
        const result = await ensureNow(room, scene);
        return result.ok && !result.kept ? 'restarted' : 'ignored';
      }),
  };
}

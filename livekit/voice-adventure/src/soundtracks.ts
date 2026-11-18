/** The scenes of the story and where LiveKit Cloud pulls each soundtrack from. */
export const SCENES = ['tavern', 'forest', 'cave', 'finale'] as const;
export type SceneName = (typeof SCENES)[number];

/**
 * LiveKit Cloud fetches the file itself, so the URL must be public: localhost doesn't work. The
 * default is this folder on the repository's main branch. Set SOUNDTRACK_BASE_URL to serve the files
 * from your own host, or SOUNDTRACK_URL_<SCENE> (for example SOUNDTRACK_URL_CAVE) for one scene.
 */
const DEFAULT_BASE = 'https://raw.githubusercontent.com/hookdeck/hookdeck-demos/main/livekit/voice-adventure/public/soundtracks';

export function soundtrackUrl(scene: SceneName, env: NodeJS.ProcessEnv = process.env): string {
  const override = env[`SOUNDTRACK_URL_${scene.toUpperCase()}`];
  if (override) return override;
  return `${(env.SOUNDTRACK_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '')}/${scene}.ogg`;
}

export const isScene = (value: unknown): value is SceneName => typeof value === 'string' && (SCENES as readonly string[]).includes(value);

/**
 * Whether LiveKit Cloud will be able to fetch the file: a HEAD request answers 2xx. Checked before an ingress is created, so the
 * storyteller is only told there is music when it can play (an unreachable URL makes the ingress fail a moment after it starts).
 */
export async function soundtrackReachable(url: string, fetcher: typeof fetch = fetch, timeout_ms = 8000): Promise<boolean> {
  try {
    let response = await fetcher(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(timeout_ms) });
    // A host that doesn't answer HEAD: ask for the first byte instead
    if (response.status === 405 || response.status === 501) response = await fetcher(url, { headers: { range: 'bytes=0-0' }, redirect: 'follow', signal: AbortSignal.timeout(timeout_ms) });
    return response.ok;
  } catch {
    return false;
  }
}

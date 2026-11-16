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

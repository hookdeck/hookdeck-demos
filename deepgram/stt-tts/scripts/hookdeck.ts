/**
 * This demo's Hookdeck CLI instance and sources. The helpers it builds on are
 * generated into hookdeck-cli.ts and hookdeck-listen.ts (see the repo's
 * _shared/ folder).
 */
import { createHookdeckCli } from './hookdeck-cli';

export const cli = createHookdeckCli();

// One source per demo; `npm run listen` forwards only these
export const SOURCES = ['deepgram-tts', 'deepgram-stt'];

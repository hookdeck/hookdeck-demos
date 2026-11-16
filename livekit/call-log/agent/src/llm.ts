/**
 * Which language model the characters use. LiveKit Inference is the default and needs only the LiveKit
 * key and secret. If OPENAI_API_KEY is set, the same model (gpt-4.1-mini) is called directly through
 * `@livekit/agents-plugin-openai` instead, for example when the Inference allowance has run out.
 * Speech-to-text and text-to-speech stay on LiveKit Inference either way, so the voices don't change.
 */
import { inference, llm } from '@livekit/agents';
import * as openai from '@livekit/agents-plugin-openai';

export interface LlmChoice {
  kind: 'openai' | 'inference';
  model: string;
}

const MODEL = 'gpt-4.1-mini';

export function chooseLlm(env: Record<string, string | undefined>): LlmChoice {
  return env.OPENAI_API_KEY?.trim() ? { kind: 'openai', model: MODEL } : { kind: 'inference', model: `openai/${MODEL}` };
}

/** One line for the startup log. It never contains the key. */
export const describeLlm = (choice: LlmChoice) =>
  choice.kind === 'openai' ? `LLM: OpenAI ${choice.model} with your OPENAI_API_KEY (speech stays on LiveKit Inference)` : `LLM: LiveKit Inference ${choice.model}`;

export function makeLlm(env: Record<string, string | undefined>): llm.LLM {
  const choice = chooseLlm(env);
  return choice.kind === 'openai' ? new openai.LLM({ model: choice.model, apiKey: env.OPENAI_API_KEY }) : new inference.LLM({ model: choice.model as any });
}

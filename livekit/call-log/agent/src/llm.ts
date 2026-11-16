/** The characters' language model: LiveKit Inference, `openai/gpt-4.1-mini`, billed to your LiveKit project. */
import { inference, llm } from '@livekit/agents';

export const LLM_MODEL = 'openai/gpt-4.1-mini';

/** One line for the startup log. */
export const describeLlm = () => `LLM: LiveKit Inference ${LLM_MODEL}`;

export const makeLlm = (): llm.LLM => new inference.LLM({ model: LLM_MODEL });

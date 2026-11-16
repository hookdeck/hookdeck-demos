/** The characters' language model: LiveKit Inference, `openai/gpt-4.1-mini`, billed to your LiveKit project. */
import { inference, llm } from '@livekit/agents';

export const LLM_MODEL = 'openai/gpt-4.1-mini';

/** One line for the startup log. */
export const describeLlm = () => `LLM: LiveKit Inference ${LLM_MODEL}`;

export const makeLlm = (): llm.LLM => new inference.LLM({ model: LLM_MODEL });

/** One small, separate call: a single short answer. Used to decide whether the players have left the scene. */
export async function askShort(prompt: { system: string; user: string }, timeout_ms = 4000): Promise<string> {
  const small = new inference.LLM({ model: LLM_MODEL, modelOptions: { max_completion_tokens: 4, temperature: 0 } as any });
  const chat_ctx = llm.ChatContext.empty();
  chat_ctx.addMessage({ role: 'system', content: prompt.system });
  chat_ctx.addMessage({ role: 'user', content: prompt.user });
  const stream = small.chat({ chatCtx: chat_ctx, toolChoice: 'none' });
  let text = '';
  const run = (async () => { for await (const chunk of stream) text += chunk.delta?.content ?? ''; return text; })();
  const timer = new Promise<string>((_, reject) => setTimeout(() => reject(new Error(`no answer within ${timeout_ms} ms`)), timeout_ms));
  try { return await Promise.race([run, timer]); } finally { stream.close(); }
}

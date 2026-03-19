/**
 * LLM helper using the Anthropic SDK.
 *
 * The ANTHROPIC_API_KEY environment variable must be set in Trigger.dev's
 * environment variables.
 */

import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set in this Trigger.dev environment. Add it under Project → Environment variables → Production, or ensure it is in .env and run npm run deploy (secrets sync on deploy)."
    );
  }
  if (!client) {
    client = new Anthropic({ apiKey });
  }
  return client;
}

/** Send a prompt to Claude and return the text response. */
export async function ask(prompt: string, maxTokens: number = 1024): Promise<string> {
  const response = await getClient().messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude");
  }

  return textBlock.text;
}

/**
 * AI-powered issue labeler.
 *
 * When an issue is created, analyzes the title and body with Claude and
 * auto-applies appropriate labels.
 *
 * In Pattern A: triggered by github-webhook-handler (no verification needed).
 * In Pattern B: triggered directly by Hookdeck (verifies independently).
 *
 * Hookdeck config for Pattern B:
 * - Filter: { "x-github-event": { "$eq": "issues" } }
 * - Destination URL: https://api.trigger.dev/api/v1/tasks/handle-issue/trigger
 */

import { task } from "@trigger.dev/sdk";
import { verifyHookdeckEvent } from "./lib/verify-hookdeck.js";
import { addLabels, parseRepo } from "./lib/github.js";
import { ask } from "./lib/ai.js";

// Labels the LLM can apply, loaded from GITHUB_LABELS env var (CSV).
// Falls back to GitHub's default labels if not set.
function getValidLabels(): string[] {
  const labelsEnv = process.env.GITHUB_LABELS;
  if (labelsEnv) {
    return labelsEnv.split(",").map((l) => l.trim()).filter(Boolean);
  }
  return ["bug", "enhancement", "question", "documentation"];
}

interface IssuePayload {
  _hookdeck?: {
    verified: boolean;
    signature?: string;
  };
  event: string;
  action: string;
  issue: {
    number: number;
    title: string;
    body: string | null;
    html_url: string;
  };
  repository: {
    full_name: string;
  };
  [key: string]: unknown;
}

export const handleIssue = task({
  id: "handle-issue",
  run: async (payload: IssuePayload) => {
    verifyHookdeckEvent(payload);

    const { owner, repo } = parseRepo(payload.repository.full_name);
    const issue = payload.issue;
    const validLabels = getValidLabels();

    console.log(`Labeling issue #${issue.number}: ${issue.title}`);
    console.log(`Available labels: ${validLabels.join(", ")}`);

    const prompt = `Classify this GitHub issue into one or more categories. Return ONLY a JSON array of labels from this list: ${JSON.stringify(validLabels)}.

Pick the most appropriate label(s) based on the issue content. If none fit well, return an empty array [].

Return only the JSON array, nothing else. Example: ["bug"] or ["enhancement", "documentation"]

Issue title: ${issue.title}
Issue body: ${issue.body ?? "(no body)"}`;

    const response = await ask(prompt, 100);

    // Parse the LLM response as a JSON array of labels
    let labels: string[];
    try {
      labels = JSON.parse(response.trim());
      if (!Array.isArray(labels)) {
        throw new Error("Response is not an array");
      }
      // Filter to only valid labels
      labels = labels.filter((l): l is string =>
        typeof l === "string" && validLabels.includes(l)
      );
    } catch {
      console.warn(`Failed to parse LLM response as labels: ${response}`);
      labels = [];
    }

    if (labels.length === 0) {
      console.log(`No labels to apply for issue #${issue.number}`);
      return { issueNumber: issue.number, labels: [] };
    }

    await addLabels(owner, repo, issue.number, labels);

    console.log(`Applied labels [${labels.join(", ")}] to issue #${issue.number}`);

    return { issueNumber: issue.number, owner, repo, labels };
  },
});

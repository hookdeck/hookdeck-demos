/**
 * AI-powered deployment summary to Slack.
 *
 * When code is pushed to the default branch, summarizes what shipped using
 * Claude and posts the summary to a Slack channel.
 *
 * In Pattern A: triggered by github-webhook-handler (no verification needed).
 * In Pattern B: triggered directly by Hookdeck (verifies independently).
 *
 * Hookdeck config for Pattern B:
 * - Filter: { "x-github-event": { "$eq": "push" } }
 * - Destination URL: https://api.trigger.dev/api/v1/tasks/handle-push/trigger
 */

import { task } from "@trigger.dev/sdk";
import { verifyHookdeckEvent } from "./lib/verify-hookdeck.js";
import { ask } from "./lib/ai.js";
import { postToSlack } from "./lib/slack.js";

interface Commit {
  id: string;
  message: string;
  author: { name: string; username?: string };
  added: string[];
  removed: string[];
  modified: string[];
}

interface PushPayload {
  _hookdeck?: {
    verified: boolean;
    signature?: string;
  };
  event: string;
  ref: string;
  compare: string;
  pusher: { name: string };
  commits: Commit[];
  repository: {
    full_name: string;
    default_branch: string;
  };
}

export const handlePush = task({
  id: "handle-push",
  run: async (payload: PushPayload) => {
    verifyHookdeckEvent(payload);

    const repoName = payload.repository.full_name;
    const branch = payload.ref.replace("refs/heads/", "");
    const defaultBranch = payload.repository.default_branch;

    // Only summarize pushes to the default branch
    if (branch !== defaultBranch) {
      console.log(`Ignoring push to non-default branch: ${branch}`);
      return { skipped: true, branch };
    }

    const commits = payload.commits ?? [];
    if (commits.length === 0) {
      console.log("No commits in push event");
      return { skipped: true, reason: "no commits" };
    }

    console.log(`Summarizing push to ${repoName}/${defaultBranch}: ${commits.length} commits`);

    // Build context for the LLM
    const commitSummary = commits
      .map((c) => {
        const files = [...c.added, ...c.modified, ...c.removed];
        return `- ${c.message} (${c.author.name}, ${files.length} files)`;
      })
      .join("\n");

    const allFiles = [
      ...new Set(commits.flatMap((c) => [...c.added, ...c.modified, ...c.removed])),
    ];

    const prompt = `Summarize this deployment for a team Slack channel. Write 2-3 sentences about what shipped. Be specific about the changes, not generic. Don't list individual commits — synthesize them into a cohesive summary.

Repository: ${repoName}
Branch: ${defaultBranch}
Pushed by: ${payload.pusher.name}
Commits (${commits.length}):
${commitSummary}

Files changed (${allFiles.length}):
${allFiles.slice(0, 30).join("\n")}${allFiles.length > 30 ? `\n... and ${allFiles.length - 30} more` : ""}`;

    const summary = await ask(prompt, 300);

    // Format the Slack message
    const slackMessage = `*Deploy: ${repoName}*\n${summary}\n\n_${commits.length} commits by ${payload.pusher.name}_ | <${payload.compare}|View diff>`;

    await postToSlack(slackMessage);

    console.log(`Posted deployment summary to Slack for ${repoName}`);

    return { repoName, branch, commitCount: commits.length, summary };
  },
});

/**
 * AI-powered deployment summary to Slack.
 *
 * On `push`, summarizes what changed using Claude and posts to Slack.
 * By default **any branch** is summarized (good for demos). Set
 * `GITHUB_PUSH_SUMMARY_DEFAULT_BRANCH_ONLY=true` in Trigger.dev env to only
 * run for the repo default branch (e.g. `main`).
 *
 * Task router path: triggered by github-webhook-handler.
 * Hookdeck connection routing: triggered directly by Hookdeck.
 *
 * Source verification (GitHub HMAC) is handled by Hookdeck at the source
 * level — only authenticated events reach this task.
 *
 * Hookdeck config for connection routing:
 * - Filter: { "x-github-event": { "$eq": "push" } }
 * - Destination URL: https://api.trigger.dev/api/v1/tasks/handle-push/trigger
 */

import { task } from "@trigger.dev/sdk";
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
  event: string;
  ref: string;
  compare: string;
  pusher: { name: string };
  commits: Commit[];
  repository: {
    full_name: string;
    default_branch: string;
  };
  [key: string]: unknown;
}

export const handlePush = task({
  id: "handle-push",
  run: async (payload: PushPayload) => {
    const repoName = payload.repository.full_name;
    const branch = payload.ref.replace("refs/heads/", "");
    const defaultBranch = payload.repository.default_branch;

    const defaultBranchOnly =
      process.env.GITHUB_PUSH_SUMMARY_DEFAULT_BRANCH_ONLY === "true" ||
      process.env.GITHUB_PUSH_SUMMARY_DEFAULT_BRANCH_ONLY === "1";

    if (defaultBranchOnly && branch !== defaultBranch) {
      console.log(
        `Ignoring push to non-default branch (${branch}; default is ${defaultBranch}) — set GITHUB_PUSH_SUMMARY_DEFAULT_BRANCH_ONLY=false to allow all branches`
      );
      return { skipped: true, branch, defaultBranch };
    }

    const commits = payload.commits ?? [];
    if (commits.length === 0) {
      console.log("No commits in push event");
      return { skipped: true, reason: "no commits" };
    }

    console.log(
      `Summarizing push to ${repoName}@${branch}${branch === defaultBranch ? " (default)" : ""}: ${commits.length} commits`
    );

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

    const prompt = `Summarize this code push for a team Slack channel. Write 2-3 sentences about what changed. Be specific, not generic. Don't list individual commits — synthesize them into a cohesive summary.

Repository: ${repoName}
Branch: ${branch}${branch === defaultBranch ? " (default branch)" : ""}
Pushed by: ${payload.pusher.name}
Commits (${commits.length}):
${commitSummary}

Files changed (${allFiles.length}):
${allFiles.slice(0, 30).join("\n")}${allFiles.length > 30 ? `\n... and ${allFiles.length - 30} more` : ""}`;

    const summary = await ask(prompt, 300);

    // Format the Slack message
    const slackMessage = `*Push: ${repoName} (${branch})*\n${summary}\n\n_${commits.length} commits by ${payload.pusher.name}_ | <${payload.compare}|View diff>`;

    await postToSlack(slackMessage);

    console.log(`Posted deployment summary to Slack for ${repoName}`);

    return { repoName, branch, commitCount: commits.length, summary };
  },
});

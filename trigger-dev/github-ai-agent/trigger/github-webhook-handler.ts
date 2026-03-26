/**
 * Trigger.dev task router.
 *
 * Receives all GitHub webhook events via a single Hookdeck connection and
 * routes them to the appropriate sub-task based on the event type.
 *
 * Source verification (GitHub HMAC) is handled by Hookdeck at the source
 * level — only authenticated events reach this task.
 *
 * Hookdeck config for this pattern:
 * - One source, one connection, one destination
 * - Destination URL: https://api.trigger.dev/api/v1/tasks/github-webhook-handler/trigger
 * - No filter rules (all events come through)
 * - trigger-wrapper transformation wraps the payload
 */

import { task, tasks } from "@trigger.dev/sdk";

interface GitHubWebhookPayload {
  event: string;
  action?: string;
  [key: string]: unknown;
}

export const githubWebhookHandler = task({
  id: "github-webhook-handler",
  run: async (payload: GitHubWebhookPayload) => {
    console.log(`Received GitHub event: ${payload.event} (action: ${payload.action ?? "none"})`);

    switch (payload.event) {
      case "pull_request":
        if (payload.action === "opened" || payload.action === "synchronize") {
          await tasks.trigger("handle-pr", payload);
          console.log(`Triggered handle-pr for PR #${payload.number}`);
        }
        break;

      case "issues":
        if (payload.action === "opened") {
          await tasks.trigger("handle-issue", payload);
          console.log(`Triggered handle-issue for issue #${(payload.issue as { number: number })?.number}`);
        }
        break;

      case "push":
        await tasks.trigger("handle-push", payload);
        console.log(`Triggered handle-push for ref ${payload.ref}`);
        break;

      default:
        console.log(`Ignoring event: ${payload.event}`);
    }
  },
});

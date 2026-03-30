/**
 * Trigger.dev task router.
 *
 * Receives all GitHub webhook events via a single Hookdeck connection and
 * routes them to the appropriate sub-task based on the event type.
 *
 * Source verification (GitHub HMAC) is handled by Hookdeck at the source
 * level — only authenticated events reach this task.
 *
 * Child tasks are triggered with Trigger.dev idempotency keys derived from
 * GitHub's X-GitHub-Delivery header (copied into the payload as
 * github_delivery_id by hookdeck/trigger-wrapper.js). That dedupes child runs
 * when the router retries or the same delivery is processed more than once.
 *
 * Hookdeck config for this pattern:
 * - One source, one connection, one destination
 * - Destination URL: https://api.trigger.dev/api/v1/tasks/github-webhook-handler/trigger
 * - No filter rules (all events come through)
 * - trigger-wrapper transformation wraps the payload
 */

import { idempotencyKeys, task, tasks } from "@trigger.dev/sdk";

interface GitHubWebhookPayload {
  event: string;
  /** Present for many event types (e.g. pull_request, issues); omitted for others such as `push`. */
  action?: string;
  /** GitHub `X-GitHub-Delivery` — one UUID per webhook POST; always set for real GitHub deliveries. */
  github_delivery_id: string;
  [key: string]: unknown;
}

async function triggerChildTask(
  taskId: "handle-pr" | "handle-issue" | "handle-push",
  payload: GitHubWebhookPayload,
  deliveryId: string
): Promise<void> {
  const idempotencyKey = await idempotencyKeys.create(`${deliveryId}-${taskId}`, {
    scope: "global",
  });
  await tasks.trigger(taskId, payload, { idempotencyKey });
}

export const githubWebhookHandler = task({
  id: "github-webhook-handler",
  run: async (payload: GitHubWebhookPayload) => {
    const deliveryId =
      typeof payload.github_delivery_id === "string" ? payload.github_delivery_id.trim() : "";
    if (!deliveryId) {
      throw new Error(
        "github_delivery_id is required (GitHub X-GitHub-Delivery). Update hookdeck/trigger-wrapper.js and re-upsert the Hookdeck connection transform."
      );
    }

    console.log(`Received GitHub event: ${payload.event} (action: ${payload.action ?? "none"})`);

    switch (payload.event) {
      case "pull_request":
        if (payload.action === "opened" || payload.action === "synchronize") {
          await triggerChildTask("handle-pr", payload, deliveryId);
          console.log(`Triggered handle-pr for PR #${payload.number}`);
        }
        break;

      case "issues":
        if (payload.action === "opened") {
          await triggerChildTask("handle-issue", payload, deliveryId);
          console.log(`Triggered handle-issue for issue #${(payload.issue as { number: number })?.number}`);
        }
        break;

      case "push":
        await triggerChildTask("handle-push", payload, deliveryId);
        console.log(`Triggered handle-push for ref ${payload.ref}`);
        break;

      default:
        console.log(`Ignoring event: ${payload.event}`);
    }
  },
});

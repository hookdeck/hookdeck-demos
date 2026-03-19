/**
 * Slack notification helper using incoming webhooks.
 *
 * The SLACK_WEBHOOK_URL environment variable must be set in Trigger.dev's
 * environment variables. Get a webhook URL from your Slack app settings
 * under Incoming Webhooks.
 */

/** Post a message to a Slack channel via incoming webhook. */
export async function postToSlack(text: string): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error("SLACK_WEBHOOK_URL environment variable is not set");
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    throw new Error(`Failed to post to Slack: ${response.status} ${response.statusText}`);
  }
}

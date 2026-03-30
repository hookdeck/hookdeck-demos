/**
 * Slack notification helper using incoming webhooks.
 *
 * The SLACK_WEBHOOK_URL environment variable must be set in Trigger.dev's
 * environment variables. Get a webhook URL from your Slack app settings
 * under Incoming Webhooks.
 */

/**
 * Post a message to a Slack channel via incoming webhook.
 * If SLACK_WEBHOOK_URL is not set, logs to console instead of failing.
 * Returns true if posted to Slack, false if logged to console.
 */
export async function postToSlack(text: string): Promise<boolean> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log("[Slack not configured] Would have posted:", text);
    return false;
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    throw new Error(`Failed to post to Slack: ${response.status} ${response.statusText}`);
  }

  return true;
}

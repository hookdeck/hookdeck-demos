/**
 * Hookdeck transformation: trigger-wrapper
 *
 * Wraps the incoming webhook payload in the { payload: { ... } } structure
 * that Trigger.dev HTTP triggers expect, and extracts:
 * - event: the GitHub event type from the X-GitHub-Event header
 * - action: the action field from the original body
 *
 * Source verification (GitHub HMAC) is handled by Hookdeck at the source
 * level — requests with invalid signatures are rejected before reaching
 * this transform. See the source configuration for the `github` source.
 *
 * This transformation is shared across all connections (task router and
 * Hookdeck-routed paths).
 */
function header(headers, name) {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key];
  }
  return undefined;
}

addHandler("transform", (request, context) => {
  request.body = {
    payload: {
      event: header(request.headers, "x-github-event"),
      action: request.body.action,
      ...request.body,
    },
  };
  return request;
});

/**
 * Hookdeck transformation: trigger-wrapper
 *
 * Wraps the incoming webhook payload in the { payload: { ... } } structure
 * that Trigger.dev expects, and injects:
 * - _hookdeck.verified: whether Hookdeck verified the source signature
 * - _hookdeck.signature: the Hookdeck-generated signature
 * - event: the GitHub event type from the X-GitHub-Event header
 *
 * This transformation is shared across all connections (both Pattern A
 * and Pattern B). It is referenced by name in the setup script.
 */
addHandler("transform", (request, context) => {
  request.body = {
    payload: {
      _hookdeck: {
        verified: request.headers["x-hookdeck-verified"] === "true",
        signature: request.headers["x-hookdeck-signature"],
      },
      event: request.headers["x-github-event"],
      action: request.body.action,
      ...request.body,
    },
  };
  return request;
});

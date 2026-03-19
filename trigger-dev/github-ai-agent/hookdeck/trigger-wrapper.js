/**
 * Hookdeck transformation: trigger-wrapper
 *
 * Wraps the incoming webhook payload in the { payload: { ... } } structure
 * that Trigger.dev expects, and injects:
 * - _hookdeck.verified: whether Hookdeck verified the source signature (see below)
 * - _hookdeck.signature: Hookdeck signing header when present on this request
 * - event: the GitHub event type from the X-GitHub-Event header
 *
 * Verified semantics:
 * - `x-hookdeck-verified` / `x-hookdeck-signature` are often added when Hookdeck
 *   *forwards* to the destination. The transform runs on the ingress request, so
 *   those headers may be missing here even when verification succeeded.
 * - When headers are absent, use `context.connection.source.verification`:
 *   if the source has verification configured, invalid signatures are rejected
 *   before the transform runs, so reaching this handler implies verification passed.
 *   If verification is not configured, there is no source signature to enforce.
 *
 * This transformation is shared across all connections (both Pattern A
 * and Pattern B). It is referenced by name in the setup script.
 */
function header(headers, name) {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key];
  }
  return undefined;
}

function isHookdeckVerified(request, context) {
  const v = header(request.headers, "x-hookdeck-verified");
  if (v === "true") return true;
  if (v === "false") return false;

  var conn = context && context.connection;
  var source = conn && conn.source;
  var verification = source && source.verification;
  if (verification && typeof verification === "object" && Object.keys(verification).length > 0) {
    // Source has verification config — failed signatures never reach this transform.
    return true;
  }

  // No source verification configured: nothing to fail at ingress for signature.
  return true;
}

addHandler("transform", (request, context) => {
  request.body = {
    payload: {
      _hookdeck: {
        verified: isHookdeckVerified(request, context),
        signature: header(request.headers, "x-hookdeck-signature"),
      },
      event: header(request.headers, "x-github-event"),
      action: request.body.action,
      ...request.body,
    },
  };
  return request;
});

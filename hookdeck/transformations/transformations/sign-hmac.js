// Signs the payload for the destination, Stripe style: an HMAC-SHA256 of
// `${timestamp}.${body}` with a secret from the transformation's environment.
import { createHmac } from 'node:crypto';

export default {
  transform(request) {
    const body = JSON.stringify(request.body);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac('sha256', process.env.HOOKDECK_WEBHOOK_SECRET)
      .update(`${timestamp}.${body}`)
      .digest('hex');

    // The body stays an object. Hookdeck delivers the original bytes when the
    // JSON is unchanged, so this signs what's delivered as long as the sender
    // sent compact JSON. Returning the string instead would deliver it
    // JSON-encoded a second time.
    request.headers['x-signature'] = `t=${timestamp},v1=${signature}`;
    console.log(`Signed ${body.length} bytes at t=${timestamp}`);
    return request;
  },
};

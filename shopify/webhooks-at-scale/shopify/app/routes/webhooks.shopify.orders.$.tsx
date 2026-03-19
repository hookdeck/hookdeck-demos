import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

/**
 * Send a confirmation text message to the customer
 * This function will throw an error if phoneNumber is missing or null
 *
 * Note: This is a placeholder for the demo - in production you would integrate
 * with an SMS service like Twilio, MessageBird, etc.
 */
async function sendConfirmationText(phoneNumber: string): Promise<void> {
  console.log(
    `[DEBUG] sendConfirmationText called with: ${JSON.stringify(phoneNumber)}`,
  );
  console.log(`[DEBUG] !phoneNumber = ${!phoneNumber}`);

  if (!phoneNumber) {
    console.log(`[DEBUG] Throwing error: Phone number is required`);
    throw new Error("Phone number is required to send confirmation text");
  }

  // In production, this would call an SMS API:
  // await smsService.send({
  //   to: phoneNumber,
  //   message: "Your order has been confirmed!",
  // });

  console.log(`Sending confirmation text to: ${phoneNumber}`);
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const timestamp = new Date().toISOString();

  try {
    const { payload, shop } = await authenticate.webhook(request);

    const eventId = request.headers.get("x-shopify-event-id") || "unknown";
    const topic = request.headers.get("x-shopify-topic") || "unknown";

    console.log(
      `[${timestamp}] Received: ${topic} | Event ID: ${eventId} | Shop: ${shop}`,
    );

    // Process order webhooks
    if (topic === "orders/create") {
      // For new orders, send a confirmation text message
      // This will throw an error if customer.phone is missing
      const customerPhone = (payload as { customer?: { phone?: string } })
        ?.customer?.phone;

      console.log(
        `[${timestamp}] DEBUG: customerPhone = ${JSON.stringify(customerPhone)}`,
      );
      console.log(
        `[${timestamp}] DEBUG: customerPhone || "" = ${JSON.stringify(customerPhone || "")}`,
      );

      // sendConfirmationText will throw if phoneNumber is undefined/null
      // if (customerPhone) {
      await sendConfirmationText(customerPhone || "");
      // } else {
      // console.log(`[${timestamp}] Order created, no phone number found`);
      // }

      console.log(`[${timestamp}] Order created, confirmation text sent`);
    } else {
      console.log(`[${timestamp}] Processing ${topic} event`);
    }

    return new Response(
      JSON.stringify({
        status: "received",
        event_id: eventId,
        topic: topic,
        shop_domain: shop,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    const topic = request.headers.get("x-shopify-topic") || "unknown";
    const eventId = request.headers.get("x-shopify-event-id") || "unknown";

    // If it's a Response object (Shopify's authenticate.webhook throws this for auth failures)
    if (error instanceof Response) {
      console.error(
        `[${timestamp}] Webhook authentication failed: ${topic} | Event ID: ${eventId} | Status: ${error.status}`,
      );
      return error; // Return the Response as-is
    }

    // If it's an Error object (application error)
    if (error instanceof Error) {
      console.error(
        `[${timestamp}] Error processing webhook: ${topic} | Event ID: ${eventId} | ${error.message}`,
      );

      // Return 500 for application errors (like missing phone number)
      return new Response(
        JSON.stringify({
          error: error.message,
          event_id: eventId,
          topic: topic,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Fallback for unknown error types
    console.error(
      `[${timestamp}] Unknown error processing webhook: ${topic} | Event ID: ${eventId}`,
    );
    return new Response(
      JSON.stringify({
        error: "Unknown error",
        event_id: eventId,
        topic: topic,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
};

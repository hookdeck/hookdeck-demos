# Stripe

1. What is Hookdeck, and what are the common use cases? Mention a couple of customers, including Lemon Squeezy.
2. More detail on the most common Stripe-related use case: receive events, emphasizing that this centralizes event management from all API providers you are receiving webhooks from. Show the Visual designer.
3. Set up connections to both Stripe and trigger and event and then Shopify and trigger an event.
4. Show using filters to route events to different destinations.
   a. Based on event type - prioritizing specific event types.
   b. Based on payload content
5. Hands-on receiving webhooks locally with the Hookdeck CLI. Will show Stripe and also Shopify to emphasize the centralizing of webhook verification and handling.
   a. Also, show errors and the ability to replay events.
6. Transformations to augment the payload. Maybe set a value based on some custom logic or convert into a normalized payload across different providers (e.g., Twilio SMS and Vonage SMS).
7. Push the app live to some hosting provider and update Hookdeck to deliver the events to the live endpoint.
8. Push a bug to the live endpoint (whoops!) and demo the issue notification and webhook retry workflow.

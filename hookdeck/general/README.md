# Hookdeck Demo

Work-in-progress repository for code to be used when demoing Hookdeck.

## Setup

Create a `.env` with the following:

```
SHOPIFY_CUSTOMER_PHONE_NUMBER={PHONE_NUMBER}
HOOKDECK_WEBHOOK_SECRET={HOOKDECK_PROJECT_SECRET}
```

## Walkthroughs

- [General overview](../demo-scripts/overview.md)
- [PagerDuty](../demo-scripts/pagerduty.md)
- [Stripe (simple)](../demo-scripts/stripe_simple.md)
- [Stripe (detailed)](../demo-scripts/stripe_detailed.md)

## Run the app

Install the dependencies:

```bash
npm i
```

Then run the app:

```bash
npm run dev
```

Trigger a Shopify event:

```sh
npm run shopify:trigger -- {HOOKDECK_URL}
```

Trigger a number of Stripe events:

```sh
npm run stripe:batch
```

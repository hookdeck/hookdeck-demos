# Stripe Meetups Demo

## Connection setup and config with backpressure

- Terraform config for source (stripe) with 2 destinations:
  - Invoice destination (using filters)
  - Subscription destination (using filters)
  - Delivery rate configuration (1 very fast, other slow)
- Dashboard view showing the configuration
  - Show connections
  - Show Source with config
  - Show filter definition
  - Show Destination
- Events coming in as pending
  - ```sh
    npm run stripe:batch
    ```
  - May need to run a few times to trigger back pressure
- Back-pressure issue demonstration
- Adjusting the delivery rate to resolve issues
  - Update via Terraform so that it doesn't become out of sync

## PROD code failure

Events that are failing for different reason

Uncomment failing code from /api/stripe/invoices/route.ts

Push to PROD:

```sh
vercel --prod
```

Notification about the issue
Going to the issue

Fixing some code? Comment out the broken code

Push to PROD:

```sh
vercel --prod
```

Bulk retry via issue -> View Issues -> Bulk retry

## Event search and retry

- Inspecting, filtering & searching events
- Looking at payload / searching
- Manual retry of an event

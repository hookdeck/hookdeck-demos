# demo-setup

This repo serves to setup a demo environment to generate representative connections and traffic to given Hookdeck project.

The project should be clone for each demo project.

## Setup the project

Create a new project in Hookdeck and get the project API key. If you demo requests specific features or throughput, you'll need to update the organization `subscriptions` with the necessary features and the `team` `max_events_per_second` to a value above the maximum rate you want to test.

## Setup connections

Update the terraform files to create the sources, destinations, connections for your demo in `terraform/`

Terraform commands must be run through the package scripts (`bun run tf:plan`, `bun run tf:apply`, and so on). The wrapper hashes `TF_VAR_hookdeck_api_key` or `HOOKDECK_API_KEY` with SHA-256 and uses `.state/<hash>/terraform.tfstate` as the local backend, keeping projects isolated when API keys change. State paths are ignored by Git, and neither the API key nor its hash is printed.

For an existing checkout with the old shared `terraform/terraform.tfstate`, load the API key associated with that state and run `bun run tf:state:migrate` once before other Terraform commands.

## Setup request templates

Update the request templates in `templates/` with the data you want to send to your demo project. Each template should have a `base_rate_seconds` which is the number of requests per second that will be sent on average. The `data()` function should return the data you want to send to your demo project which can add some randomness to the data.

## Sending traffic

Start sending your template traffic by running `bun install` then `bun run index.ts`. The script will start sending requests to your demo project at the rate specified in the template. The rate will fluctuate up and down based on the variance percentage specified in the template.

### Shopify delivery groups demo

The `shopify-orders-api` destination groups deliveries by the `x-shopify-shop-domain` header and limits each store to 100 deliveries per minute. Traffic is probabilistically distributed across a stable pool of 50 stores, so shorter windows are not expected to contain events for every store. The organization must have the `delivery_groups` feature flag enabled before applying Terraform.

The two Shopify order templates share a traffic profile that deliberately avoids fixed steps and repeating spike shapes:

- **Ambient traffic (1–6 minutes):** aggregate order volume ranges from 900–1,800 events per minute. Total volume and store weights ease continuously toward new targets over irregular 45-second–3-minute windows while every store remains below 100 events per minute.
- **Spike (1.5–6 minutes):** aggregate order volume remains at 1,200–2,400 events per minute. One rotating store gets a randomly selected `flash-sale`, `campaign-launch`, `bulk-sync`, or `organic-surge` pattern and ramps toward an initial 160–210 events per minute. Its rate then smoothly wanders between new targets over irregular 30-second–2-minute windows, with occasional lulls.
- **Adaptive recovery:** aggregate order volume remains at 700–1,400 events per minute while the generator smoothly ramps the hot store down, estimates backlog throughout that ramp, and extends the drain window if necessary. Recovery targets keep the previously hot store below 35 events per minute once the ramp completes.

Request timing also uses a Poisson distribution, so the eased trends retain natural request-to-request noise instead of producing perfectly uniform traffic. The generator logs phase transitions and new traffic targets with their current expected per-store input rates.

## How to run for a long time

The included `Dockerfile` and `railway.json` run the generator as an always-on Railway worker. Configure `HOOKDECK_API_KEY` and `HOOKDECK_API_URL` as service variables, then deploy with `railway up --detach`. Railway restarts the worker automatically if its process exits.

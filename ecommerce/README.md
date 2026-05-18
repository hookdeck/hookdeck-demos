# demo-setup

This repo serves to setup a demo environment to generate representative connections and traffic to given Hookdeck project.

The project should be clone for each demo project.

## Setup the project

Create a new project in Hookdeck and get the project API key. If you demo requests specific features or throughput, you'll need to update the organization `subscriptions` with the necessary features and the `team` `max_events_per_second` to a value above the maximum rate you want to test.

## Setup connections

Update the terraform files to create the sources, destinations, connections for your demo in `terraform/`

## Setup request templates

Update the request templates in `templates/` with the data you want to send to your demo project. Each template should have a `base_rate_seconds` which is the number of requests per second that will be sent on average. The `data()` function should return the data you want to send to your demo project which can add some randomness to the data.

## Sending traffic

Start sending your template traffic by running `bun install` then `bun run index.ts`. The script will start sending requests to your demo project at the rate specified in the template. The rate will fluctuate up and down based on the variance percentage specified in the template.

## How to run for a long time

To run the demo during a long period, you'll need to deploy the repo to a Compute Engine instance in Google Cloud.

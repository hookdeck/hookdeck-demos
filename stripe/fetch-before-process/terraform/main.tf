variable "HOOKDECK_API_KEY" {
  type = string
}

variable "STRIPE_SECRET_KEY" {
  type = string
}

variable "BASE_URL" {
  type = string
  default = "https://hookdeck-demo.vercel.app/"
}

variable "INVOICE_EVENTS" {
  type = list(string)
  default = [
    "invoice.created",
    "invoice.deleted",
    "invoice.updated",
  ]
}

terraform {
  required_providers {
    hookdeck = {
      source = "hookdeck/hookdeck"
    }
  }
}

provider "hookdeck" {
  api_key = var.HOOKDECK_API_KEY
}

# Create the Hookdeck source for Stripe
resource "hookdeck_source" "stripe_invoice_webhooks" {
  name = "stripe_invoice_webhooks"
  type = "STRIPE"
}

## Register the Hookdeck source URL as a Stripe webhook endpoint
resource "hookdeck_webhook_registration" "stripe_registration" {
  provider = hookdeck

  register = {
    request = {
      method = "POST"
      url    = "https://api.stripe.com/v1/webhook_endpoints"
      headers = jsonencode({
        authorization = "Bearer ${var.STRIPE_SECRET_KEY}"
      })
      body = join("&", concat(
        ["url=${hookdeck_source.stripe_invoice_webhooks.url}"],
        [for event in concat(var.INVOICE_EVENTS) : "enabled_events[]=${event}"]
      ))
    }
  }
  unregister = {
    request = {
      method = "DELETE"
      url    = "https://api.stripe.com/v1/webhook_endpoints/{{.register.response.body.id}}"
      headers = jsonencode({
        authorization = "Bearer ${var.STRIPE_SECRET_KEY}"
      })
    }
  }
}

# Ensure Hookdeck verifies webhooks using the Stripe webhook secret
resource "hookdeck_source_auth" "stripe_invoice_webhooks_auth" {
  source_id = hookdeck_source.stripe_invoice_webhooks.id
  auth = jsonencode({
    webhook_secret_key = jsondecode(hookdeck_webhook_registration.stripe_registration.register.response).body.secret
  })
}

# Create a Hookdeck destination that implements the fetch before process pattern
resource "hookdeck_destination" "stripe_invoice_api" {
  name = "stripe_invoice_api"
  type = "HTTP"
  config = jsonencode({
    url       = "${var.BASE_URL}api/stripe/invoices"

    # Set the destination rate limit to ensure the Stripe API rate-limit is never exceeded
    # See https://docs.stripe.com/rate-limits?locale=en-GB

    # Live mode
    # rate_limit        = 100
    # rate_limit_period = "minute"

    # Sandbox mode
    rate_limit        = 25
    rate_limit_period = "minute"

    auth_type = "HOOKDECK_SIGNATURE"
    auth = {}
  })
}

# Destination to ingest the fetched Stripe data
resource "hookdeck_connection" "fetch_connection" {
  source_id      = hookdeck_source.stripe_invoice_webhooks.id
  destination_id = hookdeck_destination.stripe_invoice_api.id
  name = "conn_stripe_invoices"
}
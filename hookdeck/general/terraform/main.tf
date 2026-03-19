variable "HOOKDECK_API_KEY" {
  type = string
}

variable "STRIPE_SECRET_KEY" {
  type = string
}

variable "BASE_URL" {
  type    = string
  default = "https://hookdeck-demo.vercel.app/"
}

variable "INVOICE_EVENTS" {
  type = list(string)
}

variable "SUBSCRIPTION_EVENTS" {
  type = list(string)
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

resource "hookdeck_source" "stripe_source" {
  name = "stripe"
  type = "STRIPE"
}

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
        ["url=${hookdeck_source.stripe_source.url}"],
        [for event in concat(var.INVOICE_EVENTS, var.SUBSCRIPTION_EVENTS) : "enabled_events[]=${event}"]
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

resource "hookdeck_source_auth" "stripe_source_auth" {
  source_id = hookdeck_source.stripe_source.id
  auth = jsonencode({
    webhook_secret_key = jsondecode(hookdeck_webhook_registration.stripe_registration.register.response).body.secret
  })
}

resource "hookdeck_destination" "invoice_ingestion" {
  name = "invoices-api"
  type = "HTTP"
  config = jsonencode({
    url               = "${var.BASE_URL}api/stripe/invoices"
    rate_limit        = 10
    rate_limit_period = "concurrent"
    auth_type         = "HOOKDECK_SIGNATURE"
    auth              = {}
  })
}

resource "hookdeck_destination" "subscription_ingestion" {
  name = "subscriptions-api"
  type = "HTTP"
  config = jsonencode({
    url               = "${var.BASE_URL}api/stripe/subscriptions"
    rate_limit        = 10
    rate_limit_period = "minute"
    auth_type         = "HOOKDECK_SIGNATURE"
    auth              = {}
  })
}

resource "hookdeck_connection" "invoice_connection" {
  source_id      = hookdeck_source.stripe_source.id
  destination_id = hookdeck_destination.invoice_ingestion.id
  name           = "invoices"
  rules = [
    {
      filter_rule = {
        body = {
          json = jsonencode({
            type = { "$startsWith" : "invoice." }
            data = {
              object = {
                subtotal = { "$gt" : 0 }
              }
            }
          })
        }
      }

    },
    {
      retry_rule = {
        count    = 5
        interval = 30000
        strategy = "exponential"
      }
    }
  ]
}

resource "hookdeck_connection" "subscription_connection" {
  source_id      = hookdeck_source.stripe_source.id
  destination_id = hookdeck_destination.subscription_ingestion.id
  name           = "subscriptions"
  rules = [
    {
      filter_rule = {
        body = {
          json = jsonencode({
            type = { "$startsWith" : "customer.subscription." }
          })
        }
      }

    },
    {
      retry_rule = {
        count    = 5
        interval = 30000
        strategy = "exponential"
      }
    }
  ]
}

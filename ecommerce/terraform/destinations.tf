# Order Service Destination
resource "hookdeck_destination" "integration_consumer" {
  name                     = "integration-consumer"
  url                      = "https://mock.hookdeck.com/integrations/event"
  rate_limit = {
    limit  = 500
    period = "concurrent"
  }
  path_forwarding_disabled = false
  auth_method = {
    hookdeck_signature = {}
  }
}

# Product Service Destination
resource "hookdeck_destination" "integration_lp_consumer" {
  name                     = "integration-lp-consumer"
  url                      = "https://mock.hookdeck.com/integrations/event"
  rate_limit = {
    limit  = 200
    period = "concurrent"
  }
  path_forwarding_disabled = false
  auth_method = {
    hookdeck_signature = {}
  }
}

# Ticket Service Destination
resource "hookdeck_destination" "third_party_consumer" {
  name                     = "3rd-party-consumer"
  url                      = "https://mock.hookdeck.com/tickets"
  rate_limit = {
    limit  = 500
    period = "concurrent"
  }
  path_forwarding_disabled = false
  auth_method = {
    hookdeck_signature = {}
  }
} 

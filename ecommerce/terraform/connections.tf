# Shopify Connections
resource "hookdeck_connection" "shopify_orders" {
  source_id      = hookdeck_source.shopify.id
  destination_id = hookdeck_destination.shopify_orders_api.id
  name           = "shopify-orders"
  rules = [
    {
      retry_rule = {
        count    = 5
        interval = 30000
        strategy = "exponential"
      }
    },
    {
      filter_rule = {
        headers = {
          json = jsonencode({
            "x-shopify-topic" = {
              "$startsWith" = "orders/"
            }
          })
        }
      }
    }
  ]
}

resource "hookdeck_connection" "shopify_products" {
  source_id      = hookdeck_source.shopify.id
  destination_id = hookdeck_destination.shopify_products_api.id
  name           = "shopify-products-no-inv-change"
  rules = [
    {
      retry_rule = {
        count    = 5
        interval = 30000
        strategy = "exponential"
      }
    },
    {
      filter_rule = {
        headers = {
          json = jsonencode({
            "x-shopify-topic" = {
              "$startsWith" = "products/"
            }
          })
        },
        body = {
          json = jsonencode({
            variants = {
              "$not" = {
                inventory_quantity = {
                  "$ref" = "variants[$index].old_inventory_quantity"
                }
              }
            }
          })
        }
      }
    }
  ]
}

# BigCommerce Connections
resource "hookdeck_connection" "bigcommerce_orders" {
  source_id      = hookdeck_source.bigcommerce.id
  destination_id = hookdeck_destination.bigcommerce_orders_api.id
  name           = "bigcommerce-orders"
  rules = [
    {
      retry_rule = {
        count    = 5
        interval = 30000
        strategy = "exponential"
      }
    },
    {
      filter_rule = {
        body = {
          json = jsonencode({
            scope = {
              "$startsWith" = "store/order/"
            }
          })
        }
      }
    }
  ]
}

resource "hookdeck_connection" "bigcommerce_products" {
  source_id      = hookdeck_source.bigcommerce.id
  destination_id = hookdeck_destination.bigcommerce_products_api.id
  name           = "bigcommerce-products"
  rules = [
    {
      retry_rule = {
        count    = 5
        interval = 30000
        strategy = "exponential"
      }
    },
    {
      filter_rule = {
        body = {
          json = jsonencode({
            scope = {
              "$startsWith" = "store/product/"
            }
          })
        }
      }
    }
  ]
}

# WooCommerce Connections
resource "hookdeck_connection" "woocommerce_orders" {
  source_id      = hookdeck_source.woocommerce.id
  destination_id = hookdeck_destination.woocommerce_orders_api.id
  name           = "woocommerce-orders"
  rules = [
    {
      retry_rule = {
        count    = 5
        interval = 30000
        strategy = "exponential"
      }
    },
    {
      filter_rule = {
        headers = {
          json = jsonencode({
            "x-wc-webhook-topic" = {
              "$startsWith" = "order."
            }
          })
        }
      }
    }
  ]
}

resource "hookdeck_connection" "woocommerce_products" {
  source_id      = hookdeck_source.woocommerce.id
  destination_id = hookdeck_destination.woocommerce_products_api.id
  name           = "woocommerce-products"

  rules = [
    {
      retry_rule = {
        count    = 5
        interval = 30000
        strategy = "exponential"
      }
    },
    {
      filter_rule = {
        headers = {
          json = jsonencode({
            "x-wc-webhook-topic" = {
              "$startsWith" = "product."
            }
          })
        }
      }
    }
  ]
}

# Ticket Service Connections
resource "hookdeck_connection" "whatsapp_tickets" {
  source_id      = hookdeck_source.whatsapp.id
  destination_id = hookdeck_destination.whatsapp_support_inbox.id
  name           = "whatsapp-messages"

  rules = [
    {
      retry_rule = {
        count    = 5
        interval = 30000
        strategy = "exponential"
      }
    }
  ]
}

resource "hookdeck_connection" "attentive_tickets" {
  source_id      = hookdeck_source.attentive.id
  destination_id = hookdeck_destination.attentive_sms_support_inbox.id
  name           = "attentive-sms"


  rules = [
    {
      retry_rule = {
        count    = 5
        interval = 30000
        strategy = "exponential"
      }
    }
  ]
}

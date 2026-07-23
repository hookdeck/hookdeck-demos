# Shopify Order Service Destination
resource "hookdeck_destination" "shopify_orders_api" {
  name        = "shopify-orders-api"
  description = "Delivery Groups demo: Shopify orders are isolated and rate limited per store"
  type        = "HTTP"
  config = jsonencode({
    url                      = "https://mock.hookdeck.com/ecommerce/shopify/orders"
    rate_limit               = 500
    rate_limit_period        = "concurrent"
    delivery_groups = {
      key               = "headers.x-shopify-shop-domain"
      rate_limit        = 100
      rate_limit_period = "minute"
    }
    path_forwarding_disabled = true
    auth_type                = "HOOKDECK_SIGNATURE"
    auth                     = {}
  })
}

# Shopify Product Catalog Service Destination
resource "hookdeck_destination" "shopify_products_api" {
  name = "shopify-product-catalog-api"
  type = "HTTP"
  config = jsonencode({
    url                      = "https://mock.hookdeck.com/ecommerce/shopify/products"
    rate_limit               = 200
    rate_limit_period        = "concurrent"
    path_forwarding_disabled = true
    auth_type                = "HOOKDECK_SIGNATURE"
    auth                     = {}
  })
}

# BigCommerce Order Service Destination
resource "hookdeck_destination" "bigcommerce_orders_api" {
  name = "bigcommerce-orders-api"
  type = "HTTP"
  config = jsonencode({
    url                      = "https://mock.hookdeck.com/ecommerce/bigcommerce/orders"
    rate_limit               = 500
    rate_limit_period        = "concurrent"
    path_forwarding_disabled = true
    auth_type                = "HOOKDECK_SIGNATURE"
    auth                     = {}
  })
}

# BigCommerce Product Catalog Service Destination
resource "hookdeck_destination" "bigcommerce_products_api" {
  name = "bigcommerce-product-catalog-api"
  type = "HTTP"
  config = jsonencode({
    url                      = "https://mock.hookdeck.com/ecommerce/bigcommerce/products"
    rate_limit               = 200
    rate_limit_period        = "concurrent"
    path_forwarding_disabled = true
    auth_type                = "HOOKDECK_SIGNATURE"
    auth                     = {}
  })
}

# WooCommerce Order Service Destination
resource "hookdeck_destination" "woocommerce_orders_api" {
  name = "woocommerce-orders-api"
  type = "HTTP"
  config = jsonencode({
    url                      = "https://mock.hookdeck.com/ecommerce/woocommerce/orders"
    rate_limit               = 500
    rate_limit_period        = "concurrent"
    path_forwarding_disabled = true
    auth_type                = "HOOKDECK_SIGNATURE"
    auth                     = {}
  })
}

# WooCommerce Product Catalog Service Destination
resource "hookdeck_destination" "woocommerce_products_api" {
  name = "woocommerce-product-catalog-api"
  type = "HTTP"
  config = jsonencode({
    url                      = "https://mock.hookdeck.com/ecommerce/woocommerce/products"
    rate_limit               = 200
    rate_limit_period        = "concurrent"
    path_forwarding_disabled = true
    auth_type                = "HOOKDECK_SIGNATURE"
    auth                     = {}
  })
}

# WhatsApp Support Inbox Destination
resource "hookdeck_destination" "whatsapp_support_inbox" {
  name = "whatsapp-support-inbox"
  type = "HTTP"
  config = jsonencode({
    url                      = "https://mock.hookdeck.com/ecommerce/support/whatsapp"
    rate_limit               = 500
    rate_limit_period        = "concurrent"
    path_forwarding_disabled = true
    auth_type                = "HOOKDECK_SIGNATURE"
    auth                     = {}
  })
}

# Attentive SMS Support Inbox Destination
resource "hookdeck_destination" "attentive_sms_support_inbox" {
  name = "attentive-sms-support-inbox"
  type = "HTTP"
  config = jsonencode({
    url                      = "https://mock.hookdeck.com/ecommerce/support/attentive-sms"
    rate_limit               = 500
    rate_limit_period        = "concurrent"
    path_forwarding_disabled = true
    auth_type                = "HOOKDECK_SIGNATURE"
    auth                     = {}
  })
}

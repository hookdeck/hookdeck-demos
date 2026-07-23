# Shopify Source
resource "hookdeck_source" "shopify" {
  name = "shopify"
  type = "SHOPIFY"
  config = jsonencode({
    allowed_http_methods = ["POST", "PUT", "PATCH", "DELETE"]
  })
}

resource "hookdeck_source_auth" "verification_shopify" {
  source_id = hookdeck_source.shopify.id
  auth = jsonencode({
    webhook_secret_key = "secret-key"
  })
}

# BigCommerce Source
resource "hookdeck_source" "bigcommerce" {
  name = "bigcommerce"
  type = "BIGCOMMERCE"
  config = jsonencode({
    allowed_http_methods = ["POST", "PUT", "PATCH", "DELETE"]
  })
}

resource "hookdeck_source_auth" "verification_bigcommerce" {
  source_id = hookdeck_source.bigcommerce.id
  auth = jsonencode({
    webhook_secret_key = "secret-key"
  })
}

# WooCommerce Source
resource "hookdeck_source" "woocommerce" {
  name = "woocommerce"
  type = "WOOCOMMERCE"
  config = jsonencode({
    allowed_http_methods = ["POST", "PUT", "PATCH", "DELETE"]
  })
}

resource "hookdeck_source_auth" "verification_woocommerce" {
  source_id = hookdeck_source.woocommerce.id
  auth = jsonencode({
    webhook_secret_key = "secret-key"
  })
}

# WhatsApp Source
resource "hookdeck_source" "whatsapp" {
  name = "whatsapp"
  type = "WHATSAPP"
  config = jsonencode({
    allowed_http_methods = ["POST", "PUT", "PATCH", "DELETE"]
  })
}

resource "hookdeck_source_auth" "verification_whatsapp" {
  source_id = hookdeck_source.whatsapp.id
  auth = jsonencode({
    webhook_secret_key = "secret-key"
  })
}

# Attentive Source
resource "hookdeck_source" "attentive" {
  name = "attentive"
  type = "WEBHOOK"
  config = jsonencode({
    allowed_http_methods = ["POST", "PUT", "PATCH", "DELETE"]
  })
}

resource "hookdeck_source_auth" "verification_attentive" {
  source_id = hookdeck_source.attentive.id
  auth_type = "HMAC"
  auth = jsonencode({
    header_key         = "x-attentive-hmac-sha256"
    algorithm          = "sha256"
    encoding           = "base64"
    webhook_secret_key = "secret-key"
  })
}

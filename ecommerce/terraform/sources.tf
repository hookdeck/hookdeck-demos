# Shopify Source
resource "hookdeck_source" "shopify" {
  name                = "shopify"
}

resource "hookdeck_source_verification" "verification_shopify" {
  source_id = hookdeck_source.shopify.id
  verification = {
    hmac = {
      header_key = "x-shopify-hmac-sha256"
      algorithm = "sha256"
      encoding = "base64"
      webhook_secret_key = "secret-key"
    }
  }
}

# BigCommerce Source
resource "hookdeck_source" "bigcommerce" {
  name                = "bigcommerce"
}

resource "hookdeck_source_verification" "verification_bigcommerce" {
  source_id = hookdeck_source.bigcommerce.id
  verification = {
    hmac = {
      header_key = "x-bc-webhook-signature"
      algorithm = "sha256"
      encoding = "base64"
      webhook_secret_key = "secret-key"
    }
  }
}

# WooCommerce Source
resource "hookdeck_source" "woocommerce" {
  name                = "woocommerce"
}

resource "hookdeck_source_verification" "verification_woocommerce" {
  source_id = hookdeck_source.woocommerce.id
  verification = {
    hmac = {
      header_key = "x-wc-webhook-signature"
      algorithm = "sha256"
      encoding = "base64"
      webhook_secret_key = "secret-key"
    }
  }
}

# WhatsApp Source
resource "hookdeck_source" "whatsapp" {
  name                = "whatsapp"
}

resource "hookdeck_source_verification" "verification_whatsapp" {
  source_id = hookdeck_source.whatsapp.id
  verification = {
    hmac = {
      header_key = "x-hub-signature-256"
      algorithm = "sha256"
      encoding = "base64"
      webhook_secret_key = "secret-key"
    }
  }
}

# Attentive Source
resource "hookdeck_source" "attentive" {
  name                = "attentive"
}

resource "hookdeck_source_verification" "verification_attentive" {
  source_id = hookdeck_source.attentive.id
  verification = {
    hmac = {
      header_key = "x-attentive-hmac-sha256"
      algorithm = "sha256"
      encoding = "base64"
      webhook_secret_key = "secret-key"
    }
  }
}

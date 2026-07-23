terraform {
  backend "local" {}

  required_providers {
    hookdeck = {
      source  = "hookdeck/hookdeck"
      version = "2.2.1"
    }
  }
}

provider "hookdeck" {
  api_key  = var.hookdeck_api_key # Never hardcode API keys
  api_base = var.hookdeck_api_url
}

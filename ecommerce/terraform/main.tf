terraform {
  required_providers {
    hookdeck = {
      source  = "hookdeck/hookdeck"
      version = "0.6.0"
    }
  }
}

provider "hookdeck" {
  api_key = var.hookdeck_api_key  # Never hardcode API keys
} 

# The Bun wrapper loads these values from ../.env, maps the HOOKDECK_* names to
# Terraform variables, and selects state using the API key's SHA-256 hash.
# Run Terraform from the ecommerce directory with:
#
#   bun run tf:plan
#   bun run tf:apply
#
# Expected .env values:
#   export HOOKDECK_API_KEY=...
#   export HOOKDECK_API_URL=http://localhost:9000
#
# TF_VAR_hookdeck_api_key and TF_VAR_hookdeck_api_url are also accepted.

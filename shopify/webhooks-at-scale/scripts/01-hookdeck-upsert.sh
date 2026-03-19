#!/bin/bash

# Hookdeck CLI Connection Upsert Script
# This script creates or updates two Hookdeck connections:
# 1. Production connection (shopify-orders-prod) - HTTP destination
# 2. Development connection (shopify-orders-dev) - CLI destination for local debugging
# Both connections share the same source and have:
# - Topic filtering (all orders/* events)
# - Deduplication based on X-Shopify-Event-Id header
# - Low throughput limit for backpressure demos

set -e  # Exit on any error

# Get the script directory to find the .env file
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR/.."
ENV_FILE="$PROJECT_ROOT/.env"

# Load environment variables from .env file if it exists
if [ -f "$ENV_FILE" ]; then
  # Export variables from .env file, ignoring comments and empty lines
  set -a
  while IFS= read -r line || [ -n "$line" ]; do
    # Skip comments and empty lines
    if [[ ! "$line" =~ ^[[:space:]]*# ]] && [[ -n "${line// }" ]]; then
      # Export the variable (handles KEY=VALUE format)
      export "$line"
    fi
  done < "$ENV_FILE"
  set +a
fi

# Configuration
PROD_CONNECTION_NAME="shopify-orders-prod"
DEV_CONNECTION_NAME="shopify-orders-dev"
SOURCE_NAME="shopify-orders-source"
PROD_DESTINATION_NAME="shopify-orders-prod-destination"
DEV_DESTINATION_NAME="shopify-orders-dev-destination"
OUTPUT_FILE="hookdeck-connection-output.json"
DEV_OUTPUT_FILE="hookdeck-connection-dev-output.json"

# Check if DESTINATION_URL is set
if [ -z "$DESTINATION_URL" ]; then
  echo "Error: DESTINATION_URL environment variable is not set"
  echo "Please set it in your .env file or as an environment variable"
  echo "Example: DESTINATION_URL=https://your-url.com/webhook"
  exit 1
fi

echo "Creating/updating Hookdeck connections..."
echo "Production connection: $PROD_CONNECTION_NAME"
echo "Development connection: $DEV_CONNECTION_NAME"
echo "Destination URL: $DESTINATION_URL"
echo ""

# Build the rules array as JSON
# Headers should be a JSON object, not a stringified JSON string
# Fixed: Changed "order/" to "orders/" (plural)
RULES_JSON='[{"type":"filter","headers":{"x-shopify-topic":{"$startsWith":"orders/"}}},{"type":"deduplicate","include_fields":["headers.X-Shopify-Event-Id"],"window":60000}]'

# Create/update production connection (HTTP destination)
echo "Creating/updating production connection: $PROD_CONNECTION_NAME"
hookdeck connection upsert "$PROD_CONNECTION_NAME" \
  --source-name "$SOURCE_NAME" \
  --source-type WEBHOOK \
  --destination-name "$PROD_DESTINATION_NAME" \
  --destination-type HTTP \
  --destination-url "$DESTINATION_URL" \
  --destination-rate-limit 5 \
  --destination-rate-limit-period second \
  --rules "$RULES_JSON" \
  --output json > "$OUTPUT_FILE"

# Check if command succeeded
if [ $? -ne 0 ]; then
  echo "Error: hookdeck connection upsert failed for production connection"
  exit 1
fi

echo "Production connection upserted successfully."
echo ""

# Extract source URL and source ID from JSON output
# Try multiple possible paths in case the structure varies
SOURCE_URL=$(jq -r '.source.url // .data.source.url // .connection.source.url // empty' "$OUTPUT_FILE" 2>/dev/null)
SOURCE_ID=$(jq -r '.source.id // .data.source.id // .connection.source.id // empty' "$OUTPUT_FILE" 2>/dev/null)

if [ -z "$SOURCE_URL" ] || [ "$SOURCE_URL" = "null" ]; then
  echo "Warning: Could not extract source URL from JSON output"
  echo "Please check the output file: $OUTPUT_FILE"
  echo "JSON structure:"
  cat "$OUTPUT_FILE" | jq '.' 2>/dev/null || cat "$OUTPUT_FILE"
  exit 1
fi

if [ -z "$SOURCE_ID" ] || [ "$SOURCE_ID" = "null" ]; then
  echo "Warning: Could not extract source ID from JSON output"
  echo "Please check the output file: $OUTPUT_FILE"
  echo "JSON structure:"
  cat "$OUTPUT_FILE" | jq '.' 2>/dev/null || cat "$OUTPUT_FILE"
  exit 1
fi

echo "=========================================="
echo "Hookdeck Source URL:"
echo "$SOURCE_URL"
echo "Source ID: $SOURCE_ID"
echo "=========================================="
echo ""

# Create/update development connection (CLI destination) reusing the same source
echo "Creating/updating development connection: $DEV_CONNECTION_NAME"
echo "Reusing source: $SOURCE_ID"
echo ""

hookdeck connection upsert "$DEV_CONNECTION_NAME" \
  --source-id "$SOURCE_ID" \
  --destination-name "$DEV_DESTINATION_NAME" \
  --destination-type CLI \
  --destination-cli-path "/webhook" \
  --rules "$RULES_JSON" \
  --output json > "$DEV_OUTPUT_FILE"

# Check if command succeeded
if [ $? -ne 0 ]; then
  echo "Error: hookdeck connection upsert failed for development connection"
  exit 1
fi

echo "Development connection upserted successfully."
echo ""
echo "=========================================="
echo "Both connections created successfully!"
echo "=========================================="
echo "Production: $PROD_CONNECTION_NAME (HTTP destination)"
echo "Development: $DEV_CONNECTION_NAME (CLI destination)"
echo ""
echo "To use the CLI connection for local debugging, run:"
echo "  hookdeck listen 4000 $SOURCE_NAME"
echo "=========================================="
echo ""

# Get the script directory to find the template and output files
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_FILE="$SCRIPT_DIR/../shopify/shopify.app.toml.template"
OUTPUT_TOML_FILE="$SCRIPT_DIR/../shopify/shopify.app.toml"

# Check if template file exists
if [ ! -f "$TEMPLATE_FILE" ]; then
  echo "Warning: Template file not found: $TEMPLATE_FILE"
  echo "Skipping TOML file generation"
else
  # Check if output file already exists and extract existing client_id if it's not the placeholder
  EXISTING_CLIENT_ID=""
  if [ -f "$OUTPUT_TOML_FILE" ]; then
    # Extract client_id from existing file if it's not the placeholder
    EXISTING_CLIENT_ID=$(grep '^client_id = ' "$OUTPUT_TOML_FILE" | sed 's/client_id = "\(.*\)"/\1/' | grep -v "YOUR_CLIENT_ID" || echo "")
    
    if [ -n "$EXISTING_CLIENT_ID" ]; then
      echo "Found existing client_id in $OUTPUT_TOML_FILE"
      echo "This will regenerate the file but preserve your client_id."
      echo ""
      read -p "Do you want to proceed? (y/N): " -n 1 -r
      echo ""
      if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Skipping TOML file generation."
        exit 0
      fi
    else
      echo "Warning: The file $OUTPUT_TOML_FILE already exists."
      echo "This will regenerate it from the template with the new Hookdeck source URL."
      echo ""
      read -p "Do you want to proceed? (y/N): " -n 1 -r
      echo ""
      if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Skipping TOML file generation."
        exit 0
      fi
    fi
  fi
  
  # Generate shopify.app.toml from template, replacing the placeholder
  sed "s|{{HOOKDECK_URL}}|$SOURCE_URL|g" "$TEMPLATE_FILE" > "$OUTPUT_TOML_FILE"
  
  # If we had an existing client_id, restore it
  if [ -n "$EXISTING_CLIENT_ID" ]; then
    if [[ "$OSTYPE" == "darwin"* ]]; then
      sed -i '' "s|client_id = \".*\"|client_id = \"$EXISTING_CLIENT_ID\"|g" "$OUTPUT_TOML_FILE"
    else
      sed -i "s|client_id = \".*\"|client_id = \"$EXISTING_CLIENT_ID\"|g" "$OUTPUT_TOML_FILE"
    fi
  fi
  
  echo "Generated shopify.app.toml file:"
  echo "  $OUTPUT_TOML_FILE"
  echo ""
  
  # Check if client_id is still the placeholder
  if grep -q 'client_id = "YOUR_CLIENT_ID"' "$OUTPUT_TOML_FILE"; then
    echo "⚠️  WARNING: The client_id is still set to 'YOUR_CLIENT_ID'"
    echo "   You need to update it with your actual Shopify app client ID."
    echo ""
    echo "   To get your client ID:"
    echo "   1. Run 'cd shopify && shopify app dev' (recommended - creates app automatically)"
    echo "   2. Or create an app at https://partners.shopify.com and copy the Client ID"
    echo "   3. Then edit $OUTPUT_TOML_FILE and replace YOUR_CLIENT_ID"
    echo ""
  fi
  
  echo "The file has been created from the template with the Hookdeck source URL."
  echo "You can now use this file in your Shopify app configuration."
fi

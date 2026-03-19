#!/bin/bash

# Script to trigger multiple Stripe events based on terraform.tfvars

SUBSCRIPTION_EVENTS=(
  "customer.subscription.created"
  "customer.subscription.deleted"
  "customer.subscription.paused"
  "customer.subscription.pending_update_applied"
  "customer.subscription.pending_update_expired"
  "customer.subscription.resumed"
  "customer.subscription.trial_will_end"
  "customer.subscription.updated"
)

INVOICE_EVENTS=(
  "invoice.created"
  "invoice.deleted"
  "invoice.finalization_failed"
  "invoice.finalized"
  "invoice.marked_uncollectible"
  "invoice.overdue"
  "invoice.overpaid"
  "invoice.paid"
  "invoice.payment_action_required"
  "invoice.payment_failed"
  "invoice.payment_succeeded"
  "invoice.sent"
  "invoice.upcoming"
  "invoice.updated"
  "invoice.voided"
  "invoice.will_be_due"
)

# Function to trigger subscription events
trigger_subscription_events() {
  echo ""
  echo "Triggering SUBSCRIPTION_EVENTS..."
  for event_name in "${SUBSCRIPTION_EVENTS[@]}"; do
    echo "Attempting to trigger ${event_name}..."
    if stripe trigger "${event_name}"; then
      echo "${event_name} triggered successfully."
    else
      echo "Failed to trigger ${event_name}."
    fi
    # Consider adding a small delay
    # sleep 0.5
  done
}

# Function to trigger invoice events
trigger_invoice_events() {
  echo ""
  echo "Triggering INVOICE_EVENTS..."
  for event_name in "${INVOICE_EVENTS[@]}"; do
    echo "Attempting to trigger ${event_name}..."
    if stripe trigger "${event_name}"; then
      echo "${event_name} triggered successfully."
    else
      echo "Failed to trigger ${event_name}."
    fi
    # Consider adding a small delay if Stripe CLI has rate limits or if processing takes time
    # sleep 0.5
  done
}

# Main logic based on argument
EVENT_TYPE_ARG=$1

if [ -z "$EVENT_TYPE_ARG" ]; then
  echo "No argument provided, triggering all events."
  trigger_subscription_events
  trigger_invoice_events
elif [ "$EVENT_TYPE_ARG" = "subscription" ]; then
  echo "Argument 'subscription' provided, triggering only subscription events."
  trigger_subscription_events
elif [ "$EVENT_TYPE_ARG" = "invoice" ]; then
  echo "Argument 'invoice' provided, triggering only invoice events."
  trigger_invoice_events
else
  echo "Invalid argument: $EVENT_TYPE_ARG"
  echo "Usage: $0 [subscription|invoice]"
  echo "If no argument is provided, all events will be triggered."
  exit 1
fi

echo ""
echo "All specified Stripe event triggers attempted."
echo "Please check the output above for the status of each event."
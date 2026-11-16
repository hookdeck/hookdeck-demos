#!/usr/bin/env bash
# Generates real LiveKit activity with the `lk` CLI: one room, two participants
# who join, publish demo media and leave, so the call log fills with
# room_started, participant_joined, track_published, participant_left and room_finished.
#
# Needs the LiveKit CLI (https://docs.livekit.io/home/cli/): brew install livekit-cli
# Reads LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET from .env.
#
# Usage: npm run activity [-- room-name] [seconds]
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a

ROOM="${1:-call-$(date +%H%M%S)}"
SECONDS_IN_CALL="${2:-20}"

command -v lk >/dev/null || { echo "Install the LiveKit CLI first: brew install livekit-cli"; exit 1; }

echo "Creating room $ROOM"
lk room create --empty-timeout 5 "$ROOM"

echo "alice joins"
lk room join --identity alice --publish-demo "$ROOM" >/dev/null 2>&1 &
ALICE=$!
sleep 4
echo "bob joins"
lk room join --identity bob --publish-demo "$ROOM" >/dev/null 2>&1 &
BOB=$!

sleep "$SECONDS_IN_CALL"
echo "bob leaves"
kill "$BOB" 2>/dev/null || true
sleep 3
echo "alice leaves"
kill "$ALICE" 2>/dev/null || true

# room_finished fires when the room closes: --empty-timeout above closes it 5s after the last participant leaves.
# To end a call immediately instead: lk room delete "$ROOM"
echo "Done. Watch the call log at http://localhost:${PORT:-4000}"

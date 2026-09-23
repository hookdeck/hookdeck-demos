#!/usr/bin/env bash
# Step the scripted scenes at a fixed clock and encode two looping GIFs.
# Chrome screenshots a local static server so the page can load scene.js.
set -euo pipefail

cd "$(dirname "$0")"
VIZ="$(pwd)"

if [[ -n "${CHROME:-}" ]]; then
  :
elif [[ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]]; then
  CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
elif command -v google-chrome >/dev/null 2>&1; then
  CHROME="$(command -v google-chrome)"
elif command -v chromium >/dev/null 2>&1; then
  CHROME="$(command -v chromium)"
else
  echo "Chrome not found. Set CHROME to the binary." >&2
  exit 1
fi

FPS=12
# Keep this equal to DURATION in scene.js. The clock is the scripted timeline.
DURATION=14
FRAMES=$((FPS * DURATION))
WIDTH=960
HEIGHT=520
PORT="${PORT:-8765}"

python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$VIZ" >/tmp/fleet-viz-http.log 2>&1 &
SERVER_PID=$!
cleanup() {
  kill "$SERVER_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT
sleep 0.3

shot() {
  local url="$1"
  local out="$2"
  "$CHROME" \
    --headless=new \
    --disable-gpu \
    --hide-scrollbars \
    --force-device-scale-factor=1 \
    --window-size="${WIDTH},${HEIGHT}" \
    --default-background-color=12151C \
    --screenshot="$out" \
    "$url" >/dev/null 2>&1
}

for scene in per-machine per-group; do
  work="$(mktemp -d)"
  echo "capturing $scene ($FRAMES frames)"
  for ((i = 0; i < FRAMES; i++)); do
    t="$(awk -v i="$i" -v fps="$FPS" 'BEGIN { printf "%.4f", i / fps }')"
    printf -v frame "%s/frame-%04d.png" "$work" "$i"
    shot "http://127.0.0.1:${PORT}/index.html?scene=${scene}&t=${t}" "$frame"
  done

  palette="$work/palette.png"
  ffmpeg -y -framerate "$FPS" -i "$work/frame-%04d.png" \
    -vf "palettegen=stats_mode=diff" -update 1 "$palette" >/dev/null
  ffmpeg -y -framerate "$FPS" -i "$work/frame-%04d.png" -i "$palette" \
    -lavfi "paletteuse=dither=bayer:bayer_scale=3" \
    -loop 0 "$VIZ/${scene}.gif" >/dev/null
  rm -rf "$work"
  echo "wrote ${scene}.gif"
done

#!/usr/bin/env bash
# Steps each scripted scene at a fixed clock and encodes a looping GIF per scene.
# Chrome screenshots a local static server so the page can load viz.js and the design system.
#
#   viz/capture.sh                      # every scene, light theme
#   viz/capture.sh listen-gap           # one scene
#   THEME=dark AUTH=bearer DELIVERY=http viz/capture.sh delivery
set -euo pipefail

cd "$(dirname "$0")"
VIZ="$(pwd)"
OUT="$VIZ/gifs"
mkdir -p "$OUT"

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

FPS="${FPS:-12}"
WIDTH=1200
HEIGHT=600
PORT="${PORT:-8767}"
THEME="${THEME:-light}"
EXTRA="theme=${THEME}${AUTH:+&auth=$AUTH}${DELIVERY:+&delivery=$DELIVERY}"
# Keep in step with SCENES in viz.js: each scene's duration in seconds.
duration_of() {
  case "$1" in
    subscribe) echo 11 ;; delivery) echo 8 ;; duplicate) echo 10 ;; bad-signature) echo 7.5 ;;
    agent-down) echo 11.5 ;; listen-gap) echo 12.5 ;;
    *) echo "unknown scene $1" >&2; exit 1 ;;
  esac
}
if [[ $# -gt 0 ]]; then SCENES=("$@"); else SCENES=(subscribe delivery duplicate bad-signature agent-down listen-gap); fi

shot() {
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size="${WIDTH},${HEIGHT}" --virtual-time-budget=2000 \
    --screenshot="$1" "$2" >/dev/null 2>&1 && [[ -s "$1" ]]
}

python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$VIZ" >/dev/null 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" >/dev/null 2>&1 || true' EXIT
sleep 0.5

for scene in "${SCENES[@]}"; do
  duration="$(duration_of "$scene")"
  frames="$(awk -v d="$duration" -v f="$FPS" 'BEGIN { printf "%d", d * f }')"
  work="$(mktemp -d)"
  echo "capturing $scene ($frames frames)"
  for ((i = 0; i < frames; i++)); do
    t="$(awk -v i="$i" -v f="$FPS" 'BEGIN { printf "%.4f", i / f }')"
    printf -v frame "%s/frame-%04d.png" "$work" "$i"
    url="http://127.0.0.1:${PORT}/index.html?scene=${scene}&t=${t}&${EXTRA}"
    # Headless Chrome occasionally exits non-zero on one frame; try that frame once more.
    shot "$frame" "$url" || shot "$frame" "$url" || { echo "frame $i of $scene failed" >&2; exit 1; }
  done
  name="$scene${AUTH:+-$AUTH}${DELIVERY:+-$DELIVERY}$([[ "$THEME" == dark ]] && echo -dark || true)"
  ffmpeg -y -loglevel error -framerate "$FPS" -i "$work/frame-%04d.png" -vf "scale=960:-1:flags=lanczos,palettegen=stats_mode=diff" "$work/palette.png"
  ffmpeg -y -loglevel error -framerate "$FPS" -i "$work/frame-%04d.png" -i "$work/palette.png" \
    -lavfi "scale=960:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" -loop 0 "$OUT/$name.gif"
  rm -rf "$work"
  echo "wrote gifs/$name.gif ($(du -h "$OUT/$name.gif" | cut -f1))"
done

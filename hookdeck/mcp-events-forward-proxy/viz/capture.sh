#!/usr/bin/env bash
# Steps each scripted scene at a fixed clock and encodes a looping GIF per scene, or an MP4.
# Chrome screenshots a local static server so the page can load viz.js and the design system.
#
#   viz/capture.sh                      # every scene, light theme
#   viz/capture.sh listen-gap           # one scene
#   THEME=dark AUTH=bearer DELIVERY=http viz/capture.sh delivery
#   FORMAT=mp4 DELIVERY=http OUT=/tmp/clips viz/capture.sh delivery   # 1920 wide, 30 fps, H.264, for social posts
#   ASPECT=square FORMAT=mp4 DELIVERY=http viz/capture.sh delivery       # 1080x1080, with the title and a larger caption
set -euo pipefail

cd "$(dirname "$0")"
VIZ="$(pwd)"
FORMAT="${FORMAT:-gif}"
[[ "$FORMAT" == gif || "$FORMAT" == mp4 ]] || { echo "FORMAT must be gif or mp4" >&2; exit 1; }
OUT="${OUT:-$VIZ/gifs}"
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

# An MP4 is screenshotted at 2x and 30 fps, so it stays sharp at 1920 wide and moves smoothly.
if [[ "$FORMAT" == mp4 ]]; then FPS="${FPS:-30}"; SCALE="${SCALE:-2}"; else FPS="${FPS:-12}"; SCALE="${SCALE:-1}"; fi
ASPECT="${ASPECT:-wide}"
case "$ASPECT" in
  wide) WIDTH=1200; HEIGHT=600; MP4_WIDTH=1920; GIF_WIDTH=960 ;;
  # A 1:1 frame for social feeds, where a 2:1 frame's caption is too small to read on a phone.
  square) WIDTH=1080; HEIGHT=1080; MP4_WIDTH=1080; GIF_WIDTH=720 ;;
  *) echo "ASPECT must be wide or square" >&2; exit 1 ;;
esac
PORT="${PORT:-8767}"
THEME="${THEME:-light}"
EXTRA="capture=1&theme=${THEME}${AUTH:+&auth=$AUTH}${DELIVERY:+&delivery=$DELIVERY}$([[ "$ASPECT" == square ]] && echo '&frame=square' || true)"
# Keep in step with SCENES in viz.js: each scene's duration in seconds.
duration_of() {
  case "$1" in
    subscribe) echo 33 ;; delivery) echo 14 ;; duplicate) echo 16.5 ;; bad-signature) echo 10 ;;
    agent-down) echo 17.5 ;; listen-gap) echo 18.5 ;;
    *) echo "unknown scene $1" >&2; exit 1 ;;
  esac
}
if [[ $# -gt 0 ]]; then SCENES=("$@"); else SCENES=(subscribe delivery duplicate bad-signature agent-down listen-gap); fi

# Headless Chrome on macOS sometimes writes the screenshot, then crashes on teardown
# ("Teardown watchdog expired") and exits non-zero. The frame is fine, so judge the
# attempt by the file, not the exit code. Remove the file first so a stale one can't pass.
shot() {
  rm -f "$1"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor="$SCALE" \
    --window-size="${WIDTH},${HEIGHT}" --virtual-time-budget=2000 \
    --screenshot="$1" "$2" >/dev/null 2>&1 || true
  [[ -s "$1" ]]
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
    # A frame Chrome didn't write at all gets two more tries.
    shot "$frame" "$url" || shot "$frame" "$url" || shot "$frame" "$url" || { echo "frame $i of $scene failed" >&2; exit 1; }
  done
  name="$scene${AUTH:+-$AUTH}${DELIVERY:+-$DELIVERY}$([[ "$THEME" == dark ]] && echo -dark || true)$([[ "$ASPECT" == square ]] && echo -square || true)"
  if [[ "$FORMAT" == mp4 ]]; then
    # H.264 High, yuv420p and faststart: what X and LinkedIn play inline. No audio track.
    ffmpeg -y -loglevel error -framerate "$FPS" -i "$work/frame-%04d.png" \
      -vf "scale=${MP4_WIDTH}:-2:flags=lanczos,format=yuv420p" -c:v libx264 -profile:v high -preset slow -crf 18 \
      -r "$FPS" -movflags +faststart -an "$OUT/$name.mp4"
  else
    ffmpeg -y -loglevel error -framerate "$FPS" -i "$work/frame-%04d.png" -vf "scale=${GIF_WIDTH}:-1:flags=lanczos,palettegen=stats_mode=diff" "$work/palette.png"
    ffmpeg -y -loglevel error -framerate "$FPS" -i "$work/frame-%04d.png" -i "$work/palette.png" \
      -lavfi "scale=${GIF_WIDTH}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" -loop 0 "$OUT/$name.gif"
  fi
  rm -rf "$work"
  echo "wrote $OUT/$name.$FORMAT ($(du -h "$OUT/$name.$FORMAT" | cut -f1))"
done

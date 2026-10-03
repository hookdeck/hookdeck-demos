#!/bin/bash
# Regenerates the real media fixtures in fixtures/ (committed, so you only need
# this to change them). Needs ffmpeg with libmp3lame, libopus, libvpx, aac and
# libx264, plus zip, tar and gzip.
set -euo pipefail
cd "$(dirname "$0")/../fixtures"

ff() { ffmpeg -hide_banner -loglevel error -y "$@"; }

# 1.5s two-tone chirp, mono
TONE=(-f lavfi -i "sine=frequency=440:duration=0.75,aformat=channel_layouts=mono" -f lavfi -i "sine=frequency=660:duration=0.75,aformat=channel_layouts=mono" -filter_complex "[0][1]concat=n=2:v=0:a=1")
ff "${TONE[@]}" -c:a libmp3lame -b:a 32k audio.mp3
ff "${TONE[@]}" -c:a pcm_s16le -ar 8000 audio.wav
ff "${TONE[@]}" -c:a libopus -b:a 24k audio.ogg
ff "${TONE[@]}" -c:a libopus -b:a 24k audio.webm
ff "${TONE[@]}" -c:a aac -b:a 32k audio.m4a

# 2s test pattern with a tone
VIDEO=(-f lavfi -i "testsrc=size=160x90:rate=12:duration=2" -f lavfi -i "sine=frequency=440:duration=2")
ff "${VIDEO[@]}" -c:v libx264 -pix_fmt yuv420p -crf 32 -c:a aac -b:a 32k -shortest -movflags +faststart video.mp4
ff "${VIDEO[@]}" -c:v libvpx -b:v 64k -c:a libopus -b:a 24k -shortest video.webm

# Single frames of the same pattern
ff -f lavfi -i "testsrc=size=160x90:rate=1" -frames:v 1 image.png
ff -f lavfi -i "testsrc=size=160x90:rate=1" -frames:v 1 -q:v 5 image.jpg
# 1x1 lossless WebP (no WebP encoder in a typical ffmpeg build)
echo "UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==" | base64 -d > image.webp

# Archives of the audio and image fixtures
rm -f archive.zip archive.tar archive.gz
zip -q -X archive.zip audio.mp3 image.png
COPYFILE_DISABLE=1 tar --format ustar -cf archive.tar audio.mp3 image.png
gzip -9 -n -c audio.wav > archive.gz

ls -la

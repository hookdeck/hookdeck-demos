#!/usr/bin/env bash
# Makes the four scene soundtracks in public/soundtracks/ from public-domain and CC0 field recordings
# (sources and authors: public/soundtracks/CREDITS.md). Each is a 3 minute excerpt, loudness-normalized to a
# quiet level (about -35 dB mean) so the storyteller stays audible, with fades, as Ogg Vorbis (LiveKit's URL
# ingress plays it in real time). Download the originals into ./src first, with the names below.
#
#   mkdir src && cd src
#   curl -LO https://upload.wikimedia.org/wikipedia/commons/5/54/Cafe_ambiance.ogg
#   curl -L -o forest-src.ogg https://archive.org/download/aporee_45368_51521/EveshamMorningChorus.ogg
#   curl -L -o cave-src.mp3 https://archive.org/download/aporee_53174_60761/Day1Caves.mp3
#   curl -L -o finale-src.mp3 https://archive.org/download/aporee_58337_66923/StruerHarborsoundofheaveywindandsailboats.mp3
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="${1:-src}"
OUT=public/soundtracks

# make <source file> <start seconds> <name> <target loudness LUFS>
make() {
  ffmpeg -v error -y -ss "$2" -t 180 -i "$SRC/$1" \
    -af "loudnorm=I=$4:TP=-8:LRA=7,afade=t=in:d=3,afade=t=out:st=176:d=4" \
    -ac 2 -ar 32000 -c:a vorbis -strict -2 -q:a 1 "$OUT/$3.ogg"
}

make Cafe_ambiance.ogg 300 tavern -34
make forest-src.ogg 400 forest -31
make cave-src.mp3 200 cave -34
make finale-src.mp3 150 finale -34

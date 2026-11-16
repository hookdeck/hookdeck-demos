#!/usr/bin/env bash
# Generates the four scene soundtracks in public/soundtracks/ with ffmpeg: synthesized tones and
# filtered noise, 14 seconds each, quiet (mean about -33 dB) so the game master stays audible.
# Nothing here is sampled from anyone else's audio, so there is nothing to license.
# Ogg Vorbis, because LiveKit's URL ingress plays it in real time.
set -euo pipefail
cd "$(dirname "$0")/../public/soundtracks"
OUT=(-ac 2 -ar 44100 -c:a vorbis -strict -2 -q:a 3)

# tavern: a warm A minor pad with a slow tremolo
ffmpeg -v error -y -f lavfi -i "sine=f=110:d=14" -f lavfi -i "sine=f=165:d=14" -f lavfi -i "sine=f=220:d=14" -f lavfi -i "sine=f=261.63:d=14" \
  -filter_complex "[0][1][2][3]amix=inputs=4:normalize=0,tremolo=f=0.4:d=0.4,lowpass=f=900,volume=0.18,afade=t=in:d=2,afade=t=out:st=11:d=3" "${OUT[@]}" tavern.ogg

# forest: wind (band-passed pink noise) with a faint shimmer
ffmpeg -v error -y -f lavfi -i "anoisesrc=d=14:c=pink:a=0.5" -f lavfi -i "sine=f=1318:d=14" -f lavfi -i "sine=f=1760:d=14" \
  -filter_complex "[0]bandpass=f=500:w=400,tremolo=f=0.25:d=0.7[w];[1][2]amix=inputs=2:normalize=0,tremolo=f=5:d=0.6,volume=0.03[s];[w][s]amix=inputs=2:normalize=0,volume=18dB,afade=t=in:d=2,afade=t=out:st=11:d=3" "${OUT[@]}" forest.ogg

# cave: a low drone with slow beating and dark noise
ffmpeg -v error -y -f lavfi -i "sine=f=55:d=14" -f lavfi -i "sine=f=58:d=14" -f lavfi -i "anoisesrc=d=14:c=brown:a=0.4" \
  -filter_complex "[0][1]amix=inputs=2:normalize=0,volume=0.5[d];[2]lowpass=f=300,volume=0.5[n];[d][n]amix=inputs=2:normalize=0,volume=0.35,afade=t=in:d=2,afade=t=out:st=11:d=3" "${OUT[@]}" cave.ogg

# finale: a rising C major pad
ffmpeg -v error -y -f lavfi -i "sine=f=130.81:d=14" -f lavfi -i "sine=f=164.81:d=14" -f lavfi -i "sine=f=196:d=14" -f lavfi -i "sine=f=261.63:d=14" \
  -filter_complex "[0][1][2][3]amix=inputs=4:normalize=0,tremolo=f=0.3:d=0.3,lowpass=f=1200,volume=0.2,afade=t=in:d=3,afade=t=out:st=11:d=3" "${OUT[@]}" finale.ogg

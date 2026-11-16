#!/usr/bin/env bash
# Generates the four scene soundtracks in public/soundtracks/ with ffmpeg: synthesized tones and
# filtered noise, 3 minutes each, quiet (mean about -36 dB) so the storyteller stays audible. A
# soundtrack keeps playing until the next scene replaces it, so each is longer than a scene usually is.
# Nothing here is sampled from anyone else's audio, so there is nothing to license.
# Ogg Vorbis, because LiveKit's URL ingress plays it in real time.
set -euo pipefail
cd "$(dirname "$0")/../public/soundtracks"
D=180
OUT=(-ac 2 -ar 44100 -c:a vorbis -strict -2 -q:a 2)
FADE="afade=t=in:d=3,afade=t=out:st=$((D - 4)):d=4"

# tavern: a warm A minor pad with slow swells, and a low hum like a crowd in the next room
ffmpeg -v error -y -f lavfi -i "sine=f=110:d=$D" -f lavfi -i "sine=f=165:d=$D" -f lavfi -i "sine=f=220:d=$D" -f lavfi -i "sine=f=261.63:d=$D" -f lavfi -i "anoisesrc=d=$D:c=brown:a=0.3" \
  -filter_complex "[0][1][2][3]amix=inputs=4:normalize=0,tremolo=f=0.35:d=0.45,vibrato=f=0.2:d=0.15,lowpass=f=900,volume=0.18[p];[4]bandpass=f=250:w=200,tremolo=f=0.11:d=0.5,volume=9dB[h];[p][h]amix=inputs=2:normalize=0,$FADE" "${OUT[@]}" tavern.ogg

# forest: wind (band-passed pink noise) that rises and falls, with a faint shimmer
ffmpeg -v error -y -f lavfi -i "anoisesrc=d=$D:c=pink:a=0.5" -f lavfi -i "sine=f=1318:d=$D" -f lavfi -i "sine=f=1760:d=$D" \
  -filter_complex "[0]bandpass=f=500:w=400,tremolo=f=0.1:d=0.7,tremolo=f=0.23:d=0.4[w];[1][2]amix=inputs=2:normalize=0,tremolo=f=5:d=0.6,tremolo=f=0.12:d=0.9,volume=0.03[s];[w][s]amix=inputs=2:normalize=0,volume=18dB,$FADE" "${OUT[@]}" forest.ogg

# cave: a low drone with slow beating and dark noise
ffmpeg -v error -y -f lavfi -i "sine=f=55:d=$D" -f lavfi -i "sine=f=58:d=$D" -f lavfi -i "sine=f=82.4:d=$D" -f lavfi -i "anoisesrc=d=$D:c=brown:a=0.4" \
  -filter_complex "[0][1][2]amix=inputs=3:normalize=0,tremolo=f=0.1:d=0.35,volume=0.4[d];[3]lowpass=f=300,tremolo=f=0.13:d=0.4,volume=0.5[n];[d][n]amix=inputs=2:normalize=0,volume=0.35,$FADE" "${OUT[@]}" cave.ogg

# finale: a rising C major pad
ffmpeg -v error -y -f lavfi -i "sine=f=130.81:d=$D" -f lavfi -i "sine=f=164.81:d=$D" -f lavfi -i "sine=f=196:d=$D" -f lavfi -i "sine=f=261.63:d=$D" -f lavfi -i "sine=f=329.63:d=$D" \
  -filter_complex "[0][1][2][3][4]amix=inputs=5:normalize=0,tremolo=f=0.18:d=0.3,vibrato=f=0.15:d=0.1,lowpass=f=1200,volume=0.2,afade=t=in:d=20,afade=t=out:st=$((D - 4)):d=4" "${OUT[@]}" finale.ogg

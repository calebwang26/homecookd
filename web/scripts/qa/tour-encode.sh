#!/usr/bin/env bash
# Turns record-tour.mjs's screencast frames into the lander's tour clips (780x1688 H.264, no audio, like the
# other app clips) with a first-frame poster each, and makes app-request.mp4 from the app's own screen on
# AWS staging (docs/build/qa/aws-dish, build 11's UI), held still. Then run `npm run media` for the WebP posters.
#
#   web/scripts/qa/tour-encode.sh /tmp/tour
set -euo pipefail
RAW="${1:?the folder record-tour.mjs wrote}"
WEB="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$WEB/public/media/app"
QA="$WEB/../docs/build/qa/aws-dish"
X264=(-c:v libx264 -preset slow -crf 26 -pix_fmt yuv420p -profile:v high -r 30 -an -movflags +faststart)

# name, speed-up, seconds cut from the start (the page loading)
clip() {
  ffmpeg -v error -y -f concat -safe 0 -i "$RAW/$1/frames.ffconcat" -ss "$3" -vf "setpts=PTS/$2,fps=30,scale=780:1688:flags=lanczos" "${X264[@]}" "$OUT/$1.mp4"
  ffmpeg -v error -y -i "$OUT/$1.mp4" -frames:v 1 -q:v 2 "$OUT/$1.jpg"
}
clip web-miss 1.5 0.6
clip web-answer 2.4 0.4
clip web-version 1 0.4

# Payoff stills (tour.ts POSTERS): the guess with Ask Mom, her version filling in, her words on the card.
ffmpeg -v error -y -sseof -0.2 -i "$OUT/web-miss.mp4" -frames:v 1 -q:v 2 -update 1 "$OUT/web-miss-ask.jpg"
ffmpeg -v error -y -sseof -0.2 -i "$OUT/web-answer.mp4" -frames:v 1 -q:v 2 -update 1 "$OUT/web-answer-sent.jpg"
ffmpeg -v error -y -sseof -0.2 -i "$OUT/web-version.mp4" -frames:v 1 -q:v 2 -update 1 "$OUT/web-version-words.jpg"

# The cook's side in the app: Leo's request, with "Film it next time you make it" (375x812, so scaled up 2x).
ffmpeg -v error -y -loop 1 -t 5 -i "$QA/2-request-leos-guess.jpg" -vf "scale=780:1688:flags=lanczos" "${X264[@]}" "$OUT/app-request.mp4"
ffmpeg -v error -y -i "$OUT/app-request.mp4" -frames:v 1 -q:v 2 "$OUT/app-request.jpg"
for f in web-miss web-answer web-version app-request; do
  printf '%s %ss %sKB\n' "$f" "$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT/$f.mp4")" "$(( $(stat -f%z "$OUT/$f.mp4") / 1024 ))"
done

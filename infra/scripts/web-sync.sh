#!/usr/bin/env bash
# Publishes web/out to the website's bucket: web-sync.sh <out dir> <bucket>. Used by .github/workflows/deploy-web.yml.
#
# The types are set by hand, because the AWS CLI's guess depends on its Python version and a file with no extension gets
# binary/octet-stream. That would break the Apple file, and Next's client only accepts text/plain for its .txt files.
# A file type that isn't listed stops the deploy before anything is uploaded.
set -euo pipefail

OUT="${1:?usage: web-sync.sh <out dir> <bucket>}"
BUCKET="${2:?usage: web-sync.sh <out dir> <bucket>}"
AASA=".well-known/apple-app-site-association"

# Everything a page needs goes up before the pages do, so a new page never points at a file that isn't there yet.
TYPES=(
  "woff2|font/woff2"
  "js|application/javascript; charset=utf-8"
  "css|text/css; charset=utf-8"
  "json|application/json; charset=utf-8"
  "webmanifest|application/manifest+json; charset=utf-8"
  "svg|image/svg+xml"
  "jpg|image/jpeg"
  "png|image/png"
  "webp|image/webp"
  "ico|image/vnd.microsoft.icon"
  "mp4|video/mp4"
  "txt|text/plain; charset=utf-8"
  "html|text/html; charset=utf-8"
)

if [ ! -f "$OUT/$AASA" ]; then
  echo "No $AASA in $OUT: universal links would break. Nothing uploaded." >&2
  exit 1
fi

known=" "
for entry in "${TYPES[@]}"; do known="$known${entry%%|*} "; done
unknown=$(cd "$OUT" && find . -type f ! -path "./$AASA" | while IFS= read -r file; do
  name="${file##*/}"
  ext="${name##*.}"
  case "$known" in (*" $ext "*) ;; (*) echo "$file" ;; esac
done)
if [ -n "$unknown" ]; then
  printf 'No content type for these, add them to TYPES. Nothing uploaded.\n%s\n' "$unknown" >&2
  exit 1
fi

for entry in "${TYPES[@]}"; do
  aws s3 sync "$OUT" "s3://$BUCKET" --no-progress --exclude '*' --include "*.${entry%%|*}" --content-type "${entry#*|}"
done
aws s3 cp "$OUT/$AASA" "s3://$BUCKET/$AASA" --no-progress --content-type application/json

# Sizes all match by now, so this only removes files the new build doesn't have. Old _next/static files stay, because a
# page someone already has open still asks for them. They're small and hashed, so they cost pennies to keep.
aws s3 sync "$OUT" "s3://$BUCKET" --no-progress --delete --size-only --exclude '_next/static/*'

#!/usr/bin/env bash
# Ping IndexNow (Bing, Yandex, Seznam, Naver) after a deploy that changed content.
# Google does NOT participate in IndexNow — it still discovers changes via the
# sitemap and normal crawling, so this is a Bing-family accelerator only.
#
# Ownership is proved by 6b6d973e8359796fa20a86dd776da94f.txt at the site root,
# which must stay deployed for submissions to be accepted.
#
# Usage:
#   ./landing/indexnow.sh                    # submit every page
#   ./landing/indexnow.sh /wedding-photo-time-capsule /support   # submit specific paths
set -euo pipefail

HOST="getcapsuleapp.com"
KEY="6b6d973e8359796fa20a86dd776da94f"

DEFAULT_PATHS=(
  "/" "/wedding-photo-time-capsule" "/time-capsule-app-for-couples"
  "/how-to-make-a-digital-time-capsule" "/graduation-time-capsule-ideas"
  "/babys-first-year-time-capsule" "/family-reunion-time-capsule"
  "/support" "/legal"
)
PATHS=("$@"); [ ${#PATHS[@]} -eq 0 ] && PATHS=("${DEFAULT_PATHS[@]}")

urls=$(printf '"https://%s%s",' "$HOST" "${PATHS[@]}" | sed 's/,$//')
payload="{\"host\":\"$HOST\",\"key\":\"$KEY\",\"keyLocation\":\"https://$HOST/$KEY.txt\",\"urlList\":[$urls]}"

echo "Submitting ${#PATHS[@]} URL(s) to IndexNow…"
code=$(curl -sS -o /tmp/indexnow-response -w '%{http_code}' \
  -X POST "https://api.indexnow.org/indexnow" \
  -H "Content-Type: application/json; charset=utf-8" \
  --data "$payload")

case "$code" in
  200|202) echo "OK ($code) — accepted." ;;
  400) echo "FAIL ($code) — malformed request."; cat /tmp/indexnow-response; exit 1 ;;
  403) echo "FAIL ($code) — key not valid. Is https://$HOST/$KEY.txt deployed and returning the key?"; exit 1 ;;
  422) echo "FAIL ($code) — URLs don't match the host, or the key doesn't match."; exit 1 ;;
  429) echo "FAIL ($code) — rate limited. Try again later."; exit 1 ;;
  *)   echo "Unexpected response $code"; cat /tmp/indexnow-response; exit 1 ;;
esac

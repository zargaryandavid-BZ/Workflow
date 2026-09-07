#!/bin/bash
# Watch docs/bazaar-inbox.md and print a wake line when Admin writes it.
set -euo pipefail
INBOX="${1:-docs/bazaar-inbox.md}"
INTERVAL="${BAZAAR_INBOX_POLL_SECONDS:-3}"

if [[ ! -f "$INBOX" ]]; then
  echo "bazaar-inbox missing: $INBOX" >&2
  exit 1
fi

last="$(stat -f %m "$INBOX" 2>/dev/null || stat -c %Y "$INBOX")"
while true; do
  sleep "$INTERVAL"
  now="$(stat -f %m "$INBOX" 2>/dev/null || stat -c %Y "$INBOX")"
  if [[ "$now" != "$last" ]]; then
    last="$now"
    echo 'AGENT_LOOP_WAKE_bazaar_inbox {"prompt":"Bazaar inbox file changed. Read docs/bazaar-inbox.md and docs/workflow-bazaar-connect.md. Process Open items (Do/Ask), then move them to Done."}'
  fi
done

#!/usr/bin/env bash
# Run the test suite.
#
#   tests/run.sh              every test
#   tests/run.sh unit         only tests/unit
#   tests/run.sh e2e          only tests/e2e
#   tests/run.sh jptext       every test whose path matches "jptext"
#
# Unit tests need nothing but node. End-to-end tests drive the real app in
# headless Chromium through Playwright; install it globally (npm i -g
# playwright && playwright install chromium) or point PLAYWRIGHT_PATH at it.
set -uo pipefail

cd "$(dirname "$0")/.."
filter="${1:-}"

case "$filter" in
  unit) files=$(ls tests/unit/*.test.js) ;;
  e2e)  files=$(ls tests/e2e/*.test.js) ;;
  "")   files=$(ls tests/unit/*.test.js tests/e2e/*.test.js) ;;
  *)    files=$(ls tests/unit/*.test.js tests/e2e/*.test.js | grep -- "$filter" || true) ;;
esac

if [ -z "$files" ]; then
  echo "no tests match '$filter'" >&2
  exit 2
fi

failed=0
declare -a summary=()
for f in $files; do
  echo "═══ $f"
  if out=$(node "$f" 2>&1); then
    printf '%s\n' "$out" | sed -n '$p'
    summary+=("ok   $f  $(printf '%s' "$out" | sed -n '$p' | sed 's/^----  //')")
  else
    printf '%s\n' "$out"
    summary+=("FAIL $f")
    failed=1
  fi
  echo
done

echo "═══ summary"
printf '%s\n' "${summary[@]}"
[ "$failed" -eq 0 ] && echo "all suites passed" || echo "SOME SUITES FAILED"
exit "$failed"

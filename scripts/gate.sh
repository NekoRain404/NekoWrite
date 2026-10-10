#!/usr/bin/env bash
# The verification gate for this repository on Linux: every check AGENTS.md requires, plus the three
# instruments and the Rust suite with its process-level cases *required* rather than skipped.
#
# **Why this file exists rather than a list of commands in a document.** The gate used to be run by
# hand, and the sequence had two properties nobody could see: a step's failure did not stop the next
# one, and the script's own exit code was the last command's — so a red `cargo test` followed by a
# successful `ls` reported success. It exited 0 on a run whose suite had failed, which is the same
# defect this repository keeps finding in its tools (a reading that does not mean what it says), and
# it is worse here than anywhere else: everything else is verified *by* this.
#
# So: every step runs even after one fails (a summary of all of them is worth more than the first
# failure), each step's status is recorded, and the exit code is 1 if ANY step failed. `--only` runs a
# subset, which is also how the failure propagation above is tested.
#
# Usage:
#   bash scripts/gate.sh                  # everything except e2e
#   bash scripts/gate.sh --with-e2e       # …and the Playwright suite (needs a browser, ~2–4 minutes)
#   bash scripts/gate.sh --only verify,fmt  # a subset; the summary still says which steps ran
#
# Steps, in the order they run:
#   verify      `pnpm verify` — typecheck, lint (with its warning ceiling), tests, perf,
#               the renderer build and the export-CSS check, in CI's order
#   fmt         `cargo fmt --all --check`
#   clippy      `cargo clippy --all-targets --locked`, then its warning ceiling (`CLIPPY_CEILING`
#               below; the warnings are read from the step's own log)
#   instruments `check-reachability.py`, `check-dead-exports.py`, `check-channels.py`
#   scripts     the suites that test this repository's own shell scripts
#   harness     the WebKit measurement harness's own `node:test` files
#   build       `tauri build --no-bundle` — the artefact the process-level cases below drive
#   rust        the whole suite with `NEKOWITE_REQUIRE_PROCESS_TESTS=1`, so a case that cannot run
#               fails instead of skipping (finding T1)
#   e2e         the Playwright suite, only with `--with-e2e`
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 90

# pnpm needs writable XDG directories on a machine whose `$HOME` is not one; the paths are the
# git-ignored scratch this repository already uses for that (`scripts/package-linux.sh` sets its own).
export XDG_DATA_HOME="${XDG_DATA_HOME:-$ROOT/.tmp-review-pnpm/data}"
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-$ROOT/.tmp-review-pnpm/cache}"
export XDG_STATE_HOME="${XDG_STATE_HOME:-$ROOT/.tmp-review-pnpm/state}"
mkdir -p "$XDG_DATA_HOME" "$XDG_STATE_HOME"

LOG_DIR="${GATE_LOG_DIR:-$ROOT/apps/desktop/src-tauri/target/gate}"
mkdir -p "$LOG_DIR"

WITH_E2E=0
ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --with-e2e) WITH_E2E=1 ;;
    --only) shift; ONLY="${1:-}" ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

# The e2e step only exists under `--with-e2e`, so `--only e2e` on its own would match nothing and the
# script would say so and exit 2 — a request for exactly that step, answered with "no step matched".
# Naming it in `--only` is the same request as passing the flag, so it implies it.
case ",$ONLY," in
  *",e2e,"*) WITH_E2E=1 ;;
esac

# The engine the process-level cases watch for has to be staged beside the built app, and removed
# again afterwards: a `target/release/opencode` left behind makes a later `cargo test` pass for a
# reason nobody chose (the handover's §9.1), and its absence makes those cases skip — which is what
# `NEKOWITE_REQUIRE_PROCESS_TESTS=1` turns into a failure rather than a quiet pass.
ENGINE_STAGED=0
stage_engine() {
  cp "$ROOT/apps/desktop/src-tauri/binaries/opencode-x86_64-unknown-linux-gnu" \
     "$ROOT/apps/desktop/src-tauri/target/release/opencode"
  ENGINE_STAGED=1
}
unstage_engine() {
  if [ "$ENGINE_STAGED" -eq 1 ]; then
    rm -f "$ROOT/apps/desktop/src-tauri/target/release/opencode"
  fi
}
trap unstage_engine EXIT

FAILED=()
RAN=()
SUMMARY=()

wanted() {
  [ -z "$ONLY" ] && return 0
  case ",$ONLY," in *",$1,"*) return 0 ;; *) return 1 ;; esac
}

step() {
  local name="$1" describe="$2"
  shift 2
  wanted "$name" || return 0
  RAN+=("$name")
  echo "### $(date -Is) $name — $describe"
  local log="$LOG_DIR/$name.log" status=0
  "$@" > "$log" 2>&1 || status=$?
  if [ "$status" -eq 0 ]; then
    echo "    PASS $name"
  else
    echo "    FAIL $name (exit $status) — $log"
    FAILED+=("$name")
  fi
  SUMMARY+=("$name|$status|$log")
}

step verify "pnpm verify" \
  pnpm verify
step fmt "cargo fmt --all --check" \
  cargo fmt --all --check --manifest-path apps/desktop/src-tauri/Cargo.toml

# `cargo clippy` runs without `-D warnings` (in this script and in CI), so on its own it can only fail
# if it crashes — a step that cannot fail. It gets a ceiling instead, with slack, and the reason for
# the slack is that clippy's version is not pinned: CI installs `dtolnay/rust-toolchain@stable`, so an
# exact ceiling would break on a toolchain bump rather than on a change somebody made. 97 unique
# warning lines when this was written; 110 leaves room for a compiler's new lint and not for a
# regression nobody read. Lower it when a commit lowers the count — `CEILING` in
# `scripts/check-dead-exports.py` is the same shape with no slack, because that instrument's input is
# this repository's own source rather than a moving toolchain.
CLIPPY_CEILING=110
clippy_step() {
  local manifest="apps/desktop/src-tauri/Cargo.toml"
  cargo clippy --all-targets --locked --manifest-path "$manifest" || return $?
  # The step's own log, by the name the `step` call below gives it.
  local count
  count="$(grep -c '^warning' "$LOG_DIR/clippy.log" 2>/dev/null || true)"
  count="${count:-0}"
  echo "clippy: $count warning lines (ceiling $CLIPPY_CEILING)"
  if [ "$count" -gt "$CLIPPY_CEILING" ]; then
    echo "clippy: above the ceiling — read the warnings in this log, or raise CLIPPY_CEILING in" >&2
    echo "scripts/gate.sh in the commit that raises it." >&2
    return 1
  fi
}
step clippy "cargo clippy --all-targets --locked, then its warning ceiling" \
  clippy_step
step instruments "the three source instruments" \
  bash -c 'status=0
    # All three run even when one fails, for the reason the whole gate does: the log is worth more
    # than the first failure. Each exits non-zero on a finding that has a clean state — a specifier
    # that resolves to nothing, a channel with no counterpart, a blind sweep or a count above the
    # ceiling recorded in `check-dead-exports.py`.
    for instrument in check-reachability check-dead-exports check-channels; do
      echo "--- $instrument"
      python3 "scripts/$instrument.py" || status=1
    done
    exit $status'
# The three suites that test the repository's own shell scripts. They were written and left unrun: no
# step here and no job in CI invoked them, so any could rot to a permanent failure with every check
# green — the same "a reading that does not mean what it says" the other instruments exist to stop,
# one level up (the scripts guard the project and nothing guarded the scripts).
#
# Each suite prints one `PASS:`/`FAIL:` line per check and sets its exit code from the failures it
# counted, so the exit code is a *summary* of the log rather than independent evidence — a suite that
# lost that last line would exit 0 with `FAIL:` in its output, and a step reading only the status
# would call that green. The log is therefore read as well, and a `FAIL:` line fails this step
# whatever the suite's own status says.
scripts_step() {
  local status=0 failed_checks=0 suite_status=0
  # Inside the gate's own log directory rather than `/tmp`, so the per-suite output it collects is
  # kept as evidence beside the log it is summarised from.
  local collected="$LOG_DIR/scripts.checks"
  : > "$collected"
  for suite in boot-probe package-linux package-portable; do
    echo "--- $suite.test.sh"
    suite_status=0
    bash "scripts/$suite.test.sh" > "$collected" 2>&1 || suite_status=$?
    cat "$collected"
    [ "$suite_status" -eq 0 ] || status=1
    failed_checks=$((failed_checks + $(grep -c '^FAIL: ' "$collected" || true)))
  done
  if [ "$failed_checks" -gt 0 ]; then
    echo "scripts: $failed_checks check(s) printed FAIL — see $collected" >&2
    status=1
  fi
  return $status
}
step scripts "the shell-script suites" \
  scripts_step

# The WebKitGTK measurement harness (`apps/desktop/e2e/webkit/`) is driven by hand against the engine
# that ships, so its probes are deliberately not gate material — but its two `*.test.mjs` files are
# pure logic: the HiDPI crop arithmetic and the verdict rules that decide whether a probe measured
# anything, both exercised through stubs. They need no engine, no browser and 63 ms. Nothing invoked
# them either: `*.test.mjs` matches no vitest project and no Playwright `spec` pattern, so they sat
# with the other assets the audit found nothing running. `node --test` is their runner, and the
# package script is the one definition of how — this step and CI both call it.
step harness "the measurement harness's own tests" \
  pnpm --filter @nekowite/desktop test:webkit-harness
step build "tauri build --no-bundle" \
  pnpm --filter @nekowite/desktop exec tauri build --no-bundle

# The suite is the one step with a precondition of its own, so it is not just a command: the engine
# is staged first (see above) and the log is read for the counts rather than the exit code alone.
rust_step() {
  stage_engine
  ls -l --time-style=+%H:%M \
    "$ROOT/apps/desktop/src-tauri/target/release/nekowite" \
    "$ROOT/apps/desktop/src-tauri/target/release/opencode"
  NEKOWITE_REQUIRE_PROCESS_TESTS=1 cargo test --locked --no-fail-fast \
    --manifest-path "$ROOT/apps/desktop/src-tauri/Cargo.toml"
}
step rust "the whole suite, process tests required" \
  rust_step

if [ "$WITH_E2E" -eq 1 ]; then
  # Playwright resolves its browser cache from `XDG_CACHE_HOME` — which this script points at the
  # repository's own scratch, for pnpm's sake, above. A machine whose browsers were installed the
  # ordinary way (`pnpm exec playwright install chromium` → `~/.cache/ms-playwright`) therefore gets
  # `browserType.launch: Executable doesn't exist` for every single test: 297 failures in about a
  # millisecond each, which reads exactly like a catastrophic regression and is not one. The step
  # pins the variable to whichever of the three plausible locations actually holds browsers, and
  # turns "no browsers anywhere" into one readable line instead of 297 phantom failures.
  e2e_step() {
    local candidates=(
      "${PLAYWRIGHT_BROWSERS_PATH:-}"
      "$XDG_CACHE_HOME/ms-playwright"
      "${HOME:-/nonexistent}/.cache/ms-playwright"
    )
    local found="" candidate
    for candidate in "${candidates[@]}"; do
      if [ -n "$candidate" ] && [ -d "$candidate" ]; then
        found="$candidate"
        break
      fi
    done
    if [ -z "$found" ]; then
      echo "no Playwright browsers in any of:" >&2
      for candidate in "${candidates[@]}"; do
        [ -n "$candidate" ] && echo "  $candidate" >&2
      done
      echo "install them with: pnpm --filter @nekowite/desktop exec playwright install chromium" >&2
      return 1
    fi
    export PLAYWRIGHT_BROWSERS_PATH="$found"
    echo "playwright browsers: $PLAYWRIGHT_BROWSERS_PATH"
    # Two workers keeps Chromium and the frozen Vite server within the release gate's four-thread budget.
    pnpm --filter @nekowite/desktop e2e --workers=2
  }
  step e2e "the Playwright suite" \
    e2e_step
fi

echo
echo "=== the gate, $(date -Is) ==="
# `grep -c` prints its count *and* exits 1 when the count is zero, so the obvious `grep -c … || echo 0`
# appends a second zero and turns one reading into two lines ("0\n0 targets"). Every count in this
# summary goes through here instead. It matters most for the line whose whole purpose is to catch zero:
# the Rust target count, where a malformed reading is exactly the kind of thing a reader skips past.
count_matches() {
  local count
  count="$(grep -c "$1" "$2" 2>/dev/null || true)"
  printf '%s' "${count:-0}"
}

# The Rust suite's passed/failed totals, plus the number of targets whose own summary says FAILED.
#
# The previous version split the line on `[ ;]` and added `$4` and `$6`. That is wrong twice over: a
# `; ` separator run makes an empty field, so the failure count landed in `$7` and every run reported
# "0 failed" — including a run with a failing target, which is the one reading this line exists for.
# (Observed: a real failing run printed "79 targets, 1408 passed, 0 failed" while cargo exited 101 and
# the log said `test result: FAILED. 0 passed; 1 failed`.) Matching the two phrases instead of
# counting fields cannot drift with the punctuation.
rust_counts() {
  local log="$1" totals failed_targets
  totals="$(grep -E '^test result:' "$log" 2>/dev/null | awk '
    {
      if (match($0, /[0-9]+ passed/)) { n = substr($0, RSTART, RLENGTH); gsub(/[^0-9]/, "", n); p += n }
      if (match($0, /[0-9]+ failed/)) { n = substr($0, RSTART, RLENGTH); gsub(/[^0-9]/, "", n); f += n }
    }
    END { printf "%d passed, %d failed", p, f }')"
  failed_targets="$(count_matches '^test result: FAILED' "$log")"
  if [ "$failed_targets" -gt 0 ]; then
    printf '%s, %s target(s) reported FAILED' "$totals" "$failed_targets"
  else
    printf '%s' "$totals"
  fi
}
for row in "${SUMMARY[@]}"; do
  IFS='|' read -r name status log <<< "$row"
  target_count=""
  case "$name" in
    rust)
      # The counts a green suite is judged by: a run that collected no targets is not a pass.
      # `rust_counts` reads them; see why the obvious `-F'[ ;]'` split is wrong there.
      target_count=" — $(count_matches '^test result:' "$log") targets, $(rust_counts "$log")"
      ;;
    verify)
      # The WORKSPACE suite's totals, summed over the package runs — not the last `Tests N passed`
      # line in the log, which is the perf project's ten. The first version of this summary reported
      # perf's count, which is a reading that looks like the suite's and is not: exactly the defect
      # this script exists to stop making.
      target_count=" — $(awk '/test: +Tests +[0-9]+ passed/ {
        match($0, /Tests +[0-9]+/); n = substr($0, RSTART, RLENGTH); gsub(/[^0-9]/, "", n);
        sum += n; runs += 1
      } END { if (runs) printf "%d tests across %d package runs", sum, runs }' "$log" 2>/dev/null)"
      ;;
    clippy)
      target_count=" — $(count_matches '^warning' "$log") warning lines"
      ;;
    scripts)
      # Each suite prints one `PASS: <name>`/`FAIL: <name>` line per check. Both are counted, and the
      # failures are shown even on a red step: a count of passing checks alone read "89 checks" for a
      # run that had failed, which is the reading-that-flatters defect this gate exists to stop. The
      # two numbers also say the suites ran their cases rather than exiting 0 having done nothing — a
      # suite whose assertions were deleted passes with either count at zero.
      target_count=" — $(count_matches '^PASS: ' "$log") checks passed, \
$(count_matches '^FAIL: ' "$log") failed"
      ;;
    harness)
      # `node --test`'s own totals — `ℹ pass 5`, `ℹ fail 0` — so a run that collected no test file at
      # all reads as zero rather than as a pass.
      target_count=" — $(grep -E '^ℹ (pass|fail) ' "$log" 2>/dev/null | awk '{printf "%s %s, ", $2, $3}' \
| sed 's/, $//')"
      ;;
    e2e)
      # Playwright's own last line. A run that collected nothing says "no tests found" and never
      # prints this, which is why the count is worth reading rather than the exit code alone.
      target_count=" — $(grep -oE '[0-9]+ passed' "$log" 2>/dev/null | tail -1)"
      ;;
  esac
  if [ "$status" -eq 0 ]; then
    printf '  PASS  %-12s (exit 0)%s\n' "$name" "$target_count"
  else
    printf '  FAIL  %-12s (exit %s)%s\n' "$name" "$status" "$target_count"
  fi
done
echo "  logs: $LOG_DIR"
if [ "${#RAN[@]}" -eq 0 ]; then
  echo "FAIL: no step matched --only '$ONLY'" >&2
  exit 2
fi
if [ "${#FAILED[@]}" -gt 0 ]; then
  echo "FAIL: ${#FAILED[@]} of ${#RAN[@]} step(s) failed: ${FAILED[*]}" >&2
  exit 1
fi
echo "PASS: all ${#RAN[@]} step(s) green."

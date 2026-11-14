#!/bin/sh
# Proves tests/rehearsal-permissions.ts detects the removal of each contract-side publication guard.
# Builds each mutant from a copy of contract/ into its own target directory (never contract/target),
# runs the permissions test against it, and fails unless every mutant is caught. Local sandbox only.
set -eu
repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$repo_root"
work=$(mktemp -d "${TMPDIR:-/tmp}/rk-mut.XXXXXX")
trap 'rm -rf "$work"' EXIT HUP INT TERM
caller_guard='env::predecessor_account_id() == env::current_account_id(),'
key_guard='env::signer_account_pk().to_string() == self.prediction_public_key,'
status=0
for mutant in caller key both; do
  dir="$work/$mutant"
  mkdir -p "$dir"
  cp -R contract "$dir/contract"
  rm -rf "$dir/contract/target"
  cp rust-toolchain.toml "$dir/"
  case "$mutant" in
    caller) patterns="$caller_guard" ;;
    key) patterns="$key_guard" ;;
    both) patterns="$caller_guard
$key_guard" ;;
  esac
  printf '%s\n' "$patterns" | while IFS= read -r guard; do
    MUTANT_GUARD="$guard" node -e '
      const fs = require("node:fs"); const file = process.argv[1]; const source = fs.readFileSync(file, "utf8");
      const guard = process.env.MUTANT_GUARD; const at = source.indexOf(guard);
      if (at < 0) { console.error("guard not found: " + guard); process.exit(1); }
      fs.writeFileSync(file, source.replace(guard, "true,"));
    ' "$dir/contract/src/lib.rs"
  done
  (cd "$dir" && CARGO_TARGET_DIR="$dir/target" cargo build -q --manifest-path contract/Cargo.toml --release --target wasm32-unknown-unknown --locked)
  wasm="$dir/target/wasm32-unknown-unknown/release/reckon_contract.wasm"
  if cmp -s "$wasm" contract/target/wasm32-unknown-unknown/release/reckon_contract.wasm; then
    echo "MUTANT $mutant: build identical to production Wasm, mutation did not apply" >&2; status=1; continue
  fi
  if RECKON_PERMISSIONS_WASM="$wasm" tsx tests/rehearsal-permissions.ts > "$dir.log" 2>&1; then
    echo "MUTANT $mutant: SURVIVED (tests/rehearsal-permissions.ts passed without the guard)" >&2; status=1
  elif grep -q -e 'a different caller cannot publish' -e 'a key other than the prediction key must not publish' -e 'the prediction key must not publish through another account' "$dir.log"; then
    echo "MUTANT $mutant: caught: $(grep -m1 -o 'AssertionError.*' "$dir.log" | cut -c1-160)"
  else
    echo "MUTANT $mutant: test failed for an unrelated reason, so the guard check is not shown:" >&2; tail -n 20 "$dir.log" >&2; status=1
  fi
done
exit "$status"

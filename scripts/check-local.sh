#!/bin/sh
set -eu

if [ -z "${NEAR_SANDBOX_BIN_PATH:-}" ] || [ -z "${NEAR_SANDBOX_BINARY_PATH:-}" ]; then
  echo 'Set NEAR_SANDBOX_BIN_PATH=1 and NEAR_SANDBOX_BINARY_PATH to the sandbox directory; see README.md.' >&2
  exit 1
fi
sandbox="$NEAR_SANDBOX_BINARY_PATH/near-sandbox"
if [ ! -x "$sandbox" ]; then
  echo "Sandbox executable not found: $sandbox. Run ./scripts/install-sandbox.sh; see README.md." >&2
  exit 1
fi
version=$("$sandbox" --version 2>&1) || { echo "Could not run sandbox: $sandbox" >&2; exit 1; }
case "$version" in
  'neard (release 2.14.0) '*) ;;
  *) echo "Expected NEAR sandbox 2.14.0, found: $version" >&2; exit 1 ;;
esac
contract_wasm=contract/target/wasm32-unknown-unknown/release/reckon_contract.wasm
oracle_fixture_wasm=contract/target/wasm32-unknown-unknown/release/reckon_oracle_fixture.wasm
if [ ! -f "$contract_wasm" ]; then
  echo 'Contract Wasm missing. Run npm run build:contract; see README.md.' >&2
  exit 1
fi
for build_input in contract/Cargo.toml contract/Cargo.lock rust-toolchain.toml; do
  if [ "$build_input" -nt "$contract_wasm" ]; then
    echo "Contract Wasm is older than $build_input. Run npm run build:contract; see README.md." >&2
    exit 1
  fi
done
stale_source=$(find contract/src -type f -name '*.rs' -newer "$contract_wasm" -print -quit)
if [ -n "$stale_source" ]; then
  echo "Contract Wasm is older than $stale_source. Run npm run build:contract; see README.md." >&2
  exit 1
fi
if [ ! -f "$oracle_fixture_wasm" ]; then
  echo 'Oracle fixture Wasm missing. Run npm run build:contract; see README.md.' >&2
  exit 1
fi
for build_input in oracle-fixture-contract/Cargo.toml oracle-fixture-contract/Cargo.lock; do
  if [ "$build_input" -nt "$oracle_fixture_wasm" ]; then
    echo "Oracle fixture Wasm is older than $build_input. Run npm run build:contract; see README.md." >&2
    exit 1
  fi
done
stale_source=$(find oracle-fixture-contract/src -type f -name '*.rs' -newer "$oracle_fixture_wasm" -print -quit)
if [ -n "$stale_source" ]; then
  echo "Oracle fixture Wasm is older than $stale_source. Run npm run build:contract; see README.md." >&2
  exit 1
fi

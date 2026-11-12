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
if [ ! -f contract/target/wasm32-unknown-unknown/release/reckon_contract.wasm ]; then
  echo 'Contract Wasm missing. Run npm run build:contract; see README.md.' >&2
  exit 1
fi

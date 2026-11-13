#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
local_node_bin="$repo_root/.local/node-v26.13.0-linux-x64/bin"
local_rust_bin="$repo_root/.local/rustup/toolchains/1.95.0-x86_64-unknown-linux-gnu/bin"
local_near_cli_bin="$repo_root/.local/near-cli/node_modules/.bin"

if [ -x "$local_node_bin/node" ]; then
  PATH="$local_node_bin${PATH:+:$PATH}"
fi

if [ -x "$local_rust_bin/cargo" ] && [ -x "$local_rust_bin/rustc" ]; then
  export CARGO_HOME="$repo_root/.local/cargo"
  export RUSTUP_HOME="$repo_root/.local/rustup"
  PATH="$local_rust_bin:$CARGO_HOME/bin:$PATH"
fi

if [ -d "$local_near_cli_bin" ]; then
  PATH="$local_near_cli_bin:$PATH"
fi

export PATH
NEAR_SANDBOX_BIN_PATH=${NEAR_SANDBOX_BIN_PATH:-1}
NEAR_SANDBOX_BINARY_PATH=${NEAR_SANDBOX_BINARY_PATH:-"$repo_root/.local/sandbox"}
export NEAR_SANDBOX_BIN_PATH NEAR_SANDBOX_BINARY_PATH

if [ "$#" -eq 0 ]; then
  printf 'Usage: %s command [args...]\n' "$0" >&2
  exit 2
fi

exec "$@"

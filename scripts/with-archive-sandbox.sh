#!/bin/sh
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
RECKON_SANDBOX_EXECUTABLE=${RECKON_SANDBOX_EXECUTABLE:-"${NEAR_SANDBOX_BINARY_PATH:?Configure the sandbox directory}/near-sandbox"}
NEAR_SANDBOX_BINARY_PATH="$script_dir/archive-sandbox"
export RECKON_SANDBOX_EXECUTABLE NEAR_SANDBOX_BINARY_PATH
exec "$@"

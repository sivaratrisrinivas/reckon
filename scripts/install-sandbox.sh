#!/bin/sh
set -eu
archive=$(mktemp)
trap 'rm -f "$archive"' EXIT
curl -fsSL https://s3-us-west-1.amazonaws.com/build.nearprotocol.com/nearcore/Linux-x86_64/2.14.0/near-sandbox.tar.gz -o "$archive"
echo "a0ba004218b218bd74351795e7ce2eda4a2b6af5cd3e252bd5e8bfe3c8f2e691  $archive" | sha256sum -c -
mkdir -p .local/sandbox
tar -xzf "$archive" --strip-components=1 -C .local/sandbox

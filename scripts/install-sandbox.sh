#!/bin/sh
set -eu
archive=$(mktemp)
trap 'rm -f "$archive"' EXIT
download_sandbox_archive() {
  curl -fsSL --retry 2 --retry-connrefused --connect-timeout 15 --max-time 180 "$1" -o "$archive"
}
default_sandbox_url=https://s3-us-west-1.amazonaws.com/build.nearprotocol.com/nearcore/Linux-x86_64/2.14.0/near-sandbox.tar.gz
if [ -n "${SANDBOX_ARTIFACT_URL:-}" ]; then
  sandbox_url=$SANDBOX_ARTIFACT_URL
  if ! download_sandbox_archive "$sandbox_url"; then
    echo "Could not download the NEAR sandbox archive from $sandbox_url." >&2
    echo 'Check the URL or use a trusted mirror of the same archive; its SHA-256 is still verified.' >&2
    exit 1
  fi
elif ! download_sandbox_archive "$default_sandbox_url"; then
  sandbox_url=https://s3.us-west-1.amazonaws.com/build.nearprotocol.com/nearcore/Linux-x86_64/2.14.0/near-sandbox.tar.gz
  echo 'Legacy S3 host failed; retrying the regional S3 endpoint.' >&2
  if ! download_sandbox_archive "$sandbox_url"; then
    echo "Could not download the NEAR sandbox archive from $default_sandbox_url or $sandbox_url." >&2
    echo 'Set SANDBOX_ARTIFACT_URL to a trusted mirror of the same archive and retry; its SHA-256 is still verified.' >&2
    exit 1
  fi
fi
echo "a0ba004218b218bd74351795e7ce2eda4a2b6af5cd3e252bd5e8bfe3c8f2e691  $archive" | sha256sum -c -
mkdir -p .local/sandbox
tar -xzf "$archive" --strip-components=1 -C .local/sandbox

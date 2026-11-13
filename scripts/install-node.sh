#!/bin/sh
set -eu

version=26.13.0
archive="node-v$version-linux-x64.tar.xz"
destination=".local/node-v$version-linux-x64"
checksum=d28a96af6c38596f6d9d97c0ee531c13d238d757742387d1928de822d959e997

[ "$(uname -s)" = Linux ] || { echo "This installer requires Linux." >&2; exit 1; }
[ "$(uname -m)" = x86_64 ] || { echo "This installer requires Linux x86-64." >&2; exit 1; }

if [ -x "$destination/bin/node" ]; then
  actual=$("$destination/bin/node" --version)
  [ "$actual" = "v$version" ] || { echo "Unexpected Node version at $destination: $actual" >&2; exit 1; }
  echo "Node $version is already installed at $destination."
  exit 0
fi

mkdir -p .local
[ ! -e "$destination" ] || { echo "$destination already exists but has no usable Node binary." >&2; exit 1; }
temporary=$(mktemp -d .local/node-install.XXXXXX)
trap 'rm -rf "$temporary"' EXIT HUP INT TERM

curl -fsSL "https://nodejs.org/dist/v$version/$archive" -o "$temporary/$archive"
printf '%s  %s\n' "$checksum" "$temporary/$archive" | sha256sum -c -
mkdir "$temporary/unpacked"
tar -xJf "$temporary/$archive" --strip-components=1 -C "$temporary/unpacked"
[ "$("$temporary/unpacked/bin/node" --version)" = "v$version" ] || { echo "Downloaded Node has an unexpected version." >&2; exit 1; }
mv "$temporary/unpacked" "$destination"
echo "Installed Node $version at $destination."
echo "Add it to PATH with: export PATH=\"\$PWD/$destination/bin:\$PATH\""

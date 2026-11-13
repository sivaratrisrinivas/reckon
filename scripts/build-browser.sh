#!/bin/sh
set -eu

mkdir -p .local/browser
node_modules/.bin/esbuild public/app.js \
  --bundle \
  --minify \
  --format=esm \
  --platform=browser \
  --target=es2022 \
  --outfile=.local/browser/app.js

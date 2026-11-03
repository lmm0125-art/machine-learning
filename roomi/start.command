#!/bin/zsh
cd "$(dirname "$0")"
exec /Users/limengmeng/.workbuddy/binaries/node/versions/22.12.0/bin/node --experimental-sqlite server.js

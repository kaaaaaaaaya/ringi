#!/bin/bash
# Launcher for the Ringi MCP gateway, for MCP clients (Claude Desktop / Cursor
# / Cline). Sets PATH so node/tsx resolve when launched by a GUI app, points at
# the local Postgres, then execs the stdio gateway.
export PATH="/Users/kaya/.nodenv/shims:$PATH"
cd /Users/kaya/Documents/ringi
export DATABASE_URL="postgres://ringi:ringi@localhost:55433/ringi"
exec ./node_modules/.bin/tsx src/mcp/gateway.ts

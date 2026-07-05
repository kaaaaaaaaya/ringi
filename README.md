# Ringi

Ringi is a decision gateway for AI business agents.
It judges an agent's risky tool call against a company Charter, returns
`APPROVE` or `BLOCK`, and stores each judgment as a hash-chained Receipt for
audit.

This repository contains:

- A Next.js Audit Console
- `POST /api/judge`, the HTTP judgment endpoint
- A stdio MCP gateway for agent clients
- A local Postgres-backed Receipt log
- Demo Charter and CRM data under `data/`

## Requirements

- Node.js 20+
- npm
- Docker Desktop or another Docker Compose-compatible runtime

## Setup

Install dependencies:

```bash
npm install
```

Start Postgres:

```bash
npm run db:up
```

Create the database tables:

```bash
npm run db:migrate
```

By default the app connects to:

```text
postgres://ringi:ringi@localhost:5432/ringi
```

If port `5432` is already in use, start Postgres on another host port:

```bash
POSTGRES_PORT=5433 npm run db:up
DATABASE_URL=postgres://ringi:ringi@localhost:5433/ringi npm run db:migrate
```

Use the same `DATABASE_URL` when running the app or MCP gateway.

## Run the Audit Console

Start the Next.js dev server:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

The console lists Receipts written by `/api/judge` or by MCP tool calls.

## Hosted Deployment

The current Sites deployment is available at:

```text
https://ringi-audit-console.isdl-28th-5429.chatgpt-team.site
```

This deployment is private. Unauthenticated requests return `401`.

The hosted app still needs a runtime `DATABASE_URL` before the Audit Console and
`POST /api/judge` can persist Receipts in production.

## Use the HTTP API

Start the dev server, then call the judgment endpoint:

```bash
curl -X POST http://localhost:3000/api/judge \
  -H 'Content-Type: application/json' \
  -d '{"tool_name":"apply_discount","params":{"discount_percent":15,"deal_id":"D-100"}}'
```

Expected result: `APPROVE`.

Try a blocked call:

```bash
curl -X POST http://localhost:3000/api/judge \
  -H 'Content-Type: application/json' \
  -d '{"tool_name":"apply_discount","params":{"discount_percent":30,"deal_id":"D-101"}}'
```

Expected result: `BLOCK` with `stop: true`.

The HTTP API writes every judgment to Postgres. If the database is unavailable,
the request fails instead of returning a persisted Receipt.

## Use the MCP Gateway

Run the stdio MCP server:

```bash
npm run mcp
```

For a quick end-to-end check, run the bundled MCP smoke test:

```bash
npm run mcp:smoke
```

The gateway currently exposes these demo tools:

- `apply_discount`
- `create_quote`
- `send_outbound_email`

The MCP gateway judges calls even when Postgres is down. In that case the
Receipt hash is returned as `(not persisted)`.

### MCP Client Configuration

Point your MCP client at the local gateway command. For example:

```json
{
  "mcpServers": {
    "ringi": {
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "/absolute/path/to/ringi"
    }
  }
}
```

If your MCP client does not support `cwd`, use an absolute launcher script like
`bin/ringi-mcp.sh` and update its paths and `DATABASE_URL` for your machine.

## Configure Judgment Behavior

The demo judge reads these local files:

- `data/sales-policy.md`: the natural-language Charter
- `data/contacts.json`: CRM-style contact data used for opt-out checks

Editing `data/sales-policy.md` changes the policy without code changes. For
example, changing the discount threshold from `20%` to `10%` changes both the
HTTP API and MCP gateway behavior.

If `ANTHROPIC_API_KEY` is set, Ringi uses Claude for judgment with
`temperature: 0`. If it is not set, Ringi uses a deterministic local mock judge
so the demo runs without external credentials.

## Development Commands

```bash
npm run dev          # Start the Next.js app
npm run build        # Build the Next.js app
npm run build:worker # Build the Cloudflare Worker bundle
npm run start        # Start the built app
npm run test         # Run Vitest tests
npm run mcp          # Start the stdio MCP gateway
npm run mcp:smoke    # Run the MCP smoke test
npm run db:up        # Start local Postgres
npm run db:migrate   # Apply db/schema.sql
npm run db:down      # Stop local Postgres
```

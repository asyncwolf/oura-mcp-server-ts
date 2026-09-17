# Oura MCP Server (Node.js / TypeScript)

An MCP server that lets Claude read your Oura Ring data: sleep, readiness,
daily activity, heart rate, workouts, and tags. Single-user (your Oura
account only), runnable two ways:

- **Local (stdio)** — for Claude Desktop on this machine. See [Local
  setup](#local-setup-stdio) below.
- **Hosted (HTTP)** — deploy it somewhere reachable over the network (a
  VPS, Fly.io, Railway, etc.) so it works from anywhere, not just this
  machine. See [Hosted setup](#hosted-setup-http) below.

Both modes share the same tool implementations and talk to the
[Oura API v2](https://cloud.ouraring.com/v2/docs) using OAuth2 — Oura
deprecated Personal Access Tokens in December 2025.

## 1. Register an application with Oura

1. Go to https://cloud.ouraring.com/oauth/applications and create a new application.
2. Set its redirect URI to match whichever mode you're setting up:
   - Local: `http://localhost:8080/callback`
   - Hosted: `https://<your-host>/oauth/callback`
   - (You can register two applications, or edit the redirect URI later, if
     you want to use both modes.)
3. Copy the **Client ID** and **Client Secret** it gives you.

## 2. Install dependencies

```bash
cd oura-mcp-server-ts
npm install
```

## Local setup (stdio)

For running from Claude Desktop on this machine only.

### 2a. Configure your credentials

Create a `.env` file in this folder:

```
OURA_CLIENT_ID=your_client_id
OURA_CLIENT_SECRET=your_client_secret
OURA_REDIRECT_URI=http://localhost:8080/callback
```

### 2b. Build

```bash
npm run build
```

This compiles `src/*.ts` into `dist/*.js`. Re-run it any time you change
the source files.

### 2c. Authorize once

```bash
npm run authorize
```

This opens your browser, you log into Oura and approve access, and the
script saves an access token + refresh token to `tokens.json` in this
folder. **Keep `tokens.json` private.** You only need to do this once;
the server automatically refreshes the access token when it expires, and
since Oura refresh tokens are single-use, it re-saves `tokens.json` with
the new pair every time.

If access is ever fully revoked or `tokens.json` is deleted, just run
`npm run authorize` again.

### 2d. Try it standalone (optional)

```bash
npm start
```

It will sit waiting for MCP messages on stdio — that's expected, it's not
a normal CLI program. Ctrl+C to stop.

### 2e. Connect it to Claude Desktop

Edit your Claude Desktop config file:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Add an entry under `mcpServers`:

```json
{
  "mcpServers": {
    "oura": {
      "command": "node",
      "args": ["/absolute/path/to/oura-mcp-server-ts/dist/server.js"]
    }
  }
}
```

Restart Claude Desktop. You should see "oura" listed as a connected tool
(hammer/tools icon), and you can ask things like:

- "What was my sleep score last night?"
- "Show my readiness trend for the past week"
- "List my workouts from the last month"

## Hosted setup (HTTP)

For running this somewhere network-reachable (a VPS, Fly.io, Railway,
etc.) so it works without Claude Desktop / this machine running. It's
still single-user — one Oura account's tokens live on the host — but
since the endpoint is reachable from anywhere, it's protected by a shared
bearer token.

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `OURA_CLIENT_ID` | yes | From step 1 |
| `OURA_CLIENT_SECRET` | yes | From step 1 |
| `OURA_REDIRECT_URI` | yes | `https://<your-host>/oauth/callback` — must exactly match what you registered with Oura |
| `MCP_API_KEY` | yes | A long random secret you generate (e.g. `openssl rand -hex 32`). Clients must send `Authorization: Bearer <MCP_API_KEY>` |
| `PORT` | no | Defaults to `8080`; most hosts set this for you |
| `TOKENS_PATH` | no | Where to persist tokens. Defaults next to the project. On a host, point this at a mounted volume, e.g. `/data/tokens.json`, so tokens survive redeploys |

### Run with Docker

```bash
docker build -t oura-mcp-server .
docker run -d \
  --name oura-mcp \
  -p 8080:8080 \
  -v oura-mcp-data:/data \
  -e OURA_CLIENT_ID=your_client_id \
  -e OURA_CLIENT_SECRET=your_client_secret \
  -e OURA_REDIRECT_URI=https://your-host/oauth/callback \
  -e MCP_API_KEY=$(openssl rand -hex 32) \
  oura-mcp-server
```

This image works as-is on any Docker-friendly host — Fly.io, Railway,
Render, or your own VPS. Point that platform's persistent volume feature
at `/data` so `tokens.json` survives restarts/redeploys.

### Or run it directly with Node (no Docker)

```bash
npm run build
MCP_API_KEY=... OURA_CLIENT_ID=... OURA_CLIENT_SECRET=... \
  OURA_REDIRECT_URI=https://your-host/oauth/callback \
  npm run start:http
```

### Authorize the hosted instance

Once it's running and reachable, visit `https://<your-host>/oauth/authorize`
in a browser, log into Oura, and approve access. That's the hosted
equivalent of `npm run authorize` — it saves tokens directly to the
host's `TOKENS_PATH`.

### Connect a client

Any MCP client that speaks the Streamable HTTP transport can connect to
`https://<your-host>/mcp`, sending header `Authorization: Bearer <MCP_API_KEY>`.
For Claude Desktop, this means adding it as a custom/remote connector
pointed at that URL with that header, rather than the local `mcpServers`
stdio config used above.

`GET /healthz` returns `200 ok` and can be used for platform health checks.

## Available tools

| Tool | Description |
|---|---|
| `get_personal_info` | Age, weight, height, biological sex |
| `get_daily_sleep` | Daily sleep score + contributors |
| `get_sleep_periods` | Detailed per-sleep-period data (stages, HRV, etc.) |
| `get_daily_readiness` | Daily readiness score + contributors |
| `get_daily_activity` | Steps, calories, activity score |
| `get_heart_rate` | Raw heart-rate time series |
| `get_workouts` | Logged workouts |
| `get_tags` | Enhanced tags (stress, illness, alcohol, etc.) |

All date-range tools default to a sensible recent window if you don't
specify `start_date` / `end_date`.

## Files

| File | Purpose |
|---|---|
| `src/ouraServer.ts` | Tool definitions, shared by both entrypoints below |
| `src/server.ts` | Local entrypoint — stdio transport, for Claude Desktop |
| `src/httpServer.ts` | Hosted entrypoint — Streamable HTTP transport, bearer-token auth, `/oauth/authorize` + `/oauth/callback` |
| `src/authorize.ts` | Run once locally to grant access and create `tokens.json` |
| `src/tokenStore.ts` | Shared helper for reading/writing tokens (path overridable via `TOKENS_PATH`) |
| `tokens.json` | Created after authorizing — holds your access/refresh tokens (git-ignored) |
| `.env` | Your `OURA_CLIENT_ID` / `OURA_CLIENT_SECRET` (git-ignored) |
| `Dockerfile` | Multi-stage build for hosted deployment (any Docker-friendly host) |

## Notes

- Single-user tool: it only ever accesses your own Oura account. In
  hosted mode, "single-user" means one account's tokens live on the
  server — `/mcp` is gated by a shared bearer token (`MCP_API_KEY`),
  not a full per-user OAuth flow.
- Trim the `SCOPES` string in `src/authorize.ts` / `src/httpServer.ts` if
  you don't want to grant all of
  email/personal/daily/heartrate/workout/tag/session/spo2.

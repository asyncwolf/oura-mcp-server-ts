# Oura MCP Server (Node.js / TypeScript)

A local MCP server that lets Claude Desktop read your Oura Ring data:
sleep, readiness, daily activity, heart rate, workouts, and tags.

This is a straight TypeScript port of the Python version — same behavior,
same tools, same local-only (stdio) architecture: it only works from
Claude Desktop on this machine, not from the phone app or claude.ai
(that would require a whole different, network-reachable server).

It talks to the [Oura API v2](https://cloud.ouraring.com/v2/docs) using
OAuth2 — Oura deprecated Personal Access Tokens in December 2025.

## 1. Register an application with Oura

1. Go to https://cloud.ouraring.com/oauth/applications and create a new application.
2. Set its redirect URI to `http://localhost:8080/callback` (or another local
   port — just keep it consistent with step 3).
3. Copy the **Client ID** and **Client Secret** it gives you.

## 2. Install dependencies

```bash
cd oura-mcp-server-ts
npm install
```

## 3. Configure your credentials

Create a `.env` file in this folder:

```
OURA_CLIENT_ID=your_client_id
OURA_CLIENT_SECRET=your_client_secret
OURA_REDIRECT_URI=http://localhost:8080/callback
```

## 4. Build

```bash
npm run build
```

This compiles `src/*.ts` into `dist/*.js`. Re-run it any time you change
the source files.

## 5. Authorize once

```bash
npm run authorize
```

This opens your browser, you log into Oura and approve access, and the
script saves an access token + refresh token to `tokens.json` in this
folder. **Keep `tokens.json` private.** You only need to do this once;
`server.ts` automatically refreshes the access token when it expires, and
since Oura refresh tokens are single-use, it re-saves `tokens.json` with
the new pair every time.

If access is ever fully revoked or `tokens.json` is deleted, just run
`npm run authorize` again.

## 6. Try it standalone (optional)

```bash
npm start
```

It will sit waiting for MCP messages on stdio — that's expected, it's not
a normal CLI program. Ctrl+C to stop.

## 7. Connect it to Claude Desktop

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
| `src/authorize.ts` | Run once to grant access and create `tokens.json` |
| `src/tokenStore.ts` | Shared helper for reading/writing `tokens.json` |
| `src/server.ts` | The actual MCP server Claude Desktop talks to |
| `tokens.json` | Created after authorizing — holds your access/refresh tokens (git-ignored) |
| `.env` | Your `OURA_CLIENT_ID` / `OURA_CLIENT_SECRET` (git-ignored) |

## A note on verification

This was written against the documented `@modelcontextprotocol/sdk` API
and Oura's published OAuth2/API docs, but it hasn't been run end-to-end
in this environment (no network access to install packages here). Before
wiring it into Claude Desktop:

1. Run `npm install` and `npm run build` and confirm there are no
   TypeScript errors.
2. Run `npm run authorize` and confirm you land on `tokens.json` with an
   `access_token` and `refresh_token` in it.
3. Run `npm start` and confirm it starts without throwing — it should
   just hang waiting for stdio input, with no errors printed.

If `npm run build` reports type errors, they're most likely due to a
version mismatch in `@modelcontextprotocol/sdk`'s API (it's under active
development) — paste the error back and it's a quick fix.

## Notes

- Single-user, local-only tool: it only ever accesses your own Oura
  account, and only from whatever machine runs `server.js`.
- Trim the `SCOPES` string in `src/authorize.ts` if you don't want to
  grant all of email/personal/daily/heartrate/workout/tag/session/spo2.

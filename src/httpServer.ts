/**
 * Oura MCP Server (HTTP / hosted mode)
 * --------------------------------------
 * Network-reachable entrypoint for running this server on a host (Fly.io,
 * Railway, a VPS, etc.) instead of locally via stdio. Speaks MCP over the
 * Streamable HTTP transport at POST/GET/DELETE /mcp.
 *
 * This is still a single-user server: one Oura account's tokens, persisted
 * at TOKENS_PATH. Since it's reachable over the network, /mcp is protected
 * by a shared bearer token (MCP_API_KEY) rather than the stdio transport's
 * implicit "only this machine can talk to it" boundary. This is NOT a full
 * multi-user OAuth-protected MCP server per the MCP auth spec - it's a
 * single shared secret, which is the appropriate amount of protection for
 * "just me, but reachable from anywhere."
 *
 * Also exposes /oauth/authorize and /oauth/callback so you can run the
 * Oura authorization flow directly against the hosted instance (visit
 * https://<your-host>/oauth/authorize in a browser) instead of only being
 * able to authorize from the machine that generated tokens.json.
 */

import "dotenv/config";
import http from "node:http";
import crypto from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createOuraServer } from "./ouraServer.js";
import { saveTokens } from "./tokenStore.js";

const PORT = Number(process.env.PORT) || 8080;
const MCP_API_KEY = process.env.MCP_API_KEY;

const CLIENT_ID = process.env.OURA_CLIENT_ID;
const CLIENT_SECRET = process.env.OURA_CLIENT_SECRET;
const REDIRECT_URI = process.env.OURA_REDIRECT_URI ?? `http://localhost:${PORT}/oauth/callback`;
const SCOPES = "email personal daily heartrate workout tag session spo2";

const AUTHORIZE_URL = "https://cloud.ouraring.com/oauth/authorize";
const TOKEN_URL = "https://api.ouraring.com/oauth/token";

if (!MCP_API_KEY) {
  console.error(
    "MCP_API_KEY is not set. Set it to a long random secret - clients must send it as " +
      "`Authorization: Bearer <MCP_API_KEY>` to reach /mcp. Refusing to start unprotected."
  );
  process.exit(1);
}

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("OURA_CLIENT_ID and OURA_CLIENT_SECRET must be set.");
  process.exit(1);
}

// Single in-flight OAuth attempt at a time is fine for a single-user server.
let pendingState: string | null = null;

function handleAuthorize(res: http.ServerResponse): void {
  pendingState = crypto.randomBytes(18).toString("base64url");
  const authUrl =
    `${AUTHORIZE_URL}?response_type=code&client_id=${CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=${encodeURIComponent(SCOPES)}&state=${pendingState}`;
  res.writeHead(302, { Location: authUrl });
  res.end();
}

async function handleCallback(url: URL, res: http.ServerResponse): Promise<void> {
  const params = url.searchParams;

  if (params.get("error")) {
    res.writeHead(400, { "Content-Type": "text/html" });
    res.end(`<h1>Authorization denied.</h1>${params.get("error")}`);
    return;
  }

  const code = params.get("code");
  if (!code || !pendingState || params.get("state") !== pendingState) {
    res.writeHead(400, { "Content-Type": "text/html" });
    res.end("<h1>Something went wrong.</h1>Missing or mismatched state. Try /oauth/authorize again.");
    return;
  }
  pendingState = null;

  try {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID as string,
        client_secret: CLIENT_SECRET as string,
      }),
    });

    if (!response.ok) {
      throw new Error(`Token exchange failed: ${response.status} ${await response.text()}`);
    }

    const tokens = await response.json();
    saveTokens(tokens);

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<h1>Authorized!</h1>This server can now read your Oura data. You can close this tab.");
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/html" });
    res.end(`<h1>Authorization failed.</h1>${err instanceof Error ? err.message : String(err)}`);
  }
}

function isAuthorized(req: http.IncomingMessage): boolean {
  const header = req.headers.authorization ?? "";
  const [scheme, token] = header.split(" ");
  return scheme === "Bearer" && token === MCP_API_KEY;
}

async function handleMcp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!isAuthorized(req)) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  // Stateless mode: a fresh server + transport per request. Simple and
  // sufficient for a single-user, low-traffic personal MCP server.
  const server = createOuraServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on("close", () => {
    transport.close();
    server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res);
}

const httpServer = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (url.pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }

  if (url.pathname === "/oauth/authorize") {
    handleAuthorize(res);
    return;
  }

  if (url.pathname === "/oauth/callback") {
    handleCallback(url, res).catch((err) => {
      res.writeHead(500);
      res.end(String(err));
    });
    return;
  }

  if (url.pathname === "/mcp") {
    handleMcp(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
      }
      res.end(JSON.stringify({ error: "Internal server error" }));
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

httpServer.listen(PORT, () => {
  console.log(`Oura MCP server listening on :${PORT}`);
  console.log(`MCP endpoint:      http://localhost:${PORT}/mcp  (requires Authorization: Bearer <MCP_API_KEY>)`);
  console.log(`Oura authorize at: http://localhost:${PORT}/oauth/authorize`);
});

/**
 * One-time OAuth2 authorization script for the Oura MCP server.
 *
 * Run this once (and again whenever tokens.json is deleted or fully revoked)
 * to grant this app access to your Oura account. It spins up a tiny local
 * web server to catch Oura's redirect, exchanges the auth code for tokens,
 * and saves them to tokens.json for server.ts to use.
 *
 * Usage:
 *     npm run build && npm run authorize
 */

import "dotenv/config";
import http from "node:http";
import { URL } from "node:url";
import crypto from "node:crypto";
import open from "open";
import { saveTokens } from "./tokenStore.js";

const CLIENT_ID = process.env.OURA_CLIENT_ID;
const CLIENT_SECRET = process.env.OURA_CLIENT_SECRET;
const REDIRECT_URI = process.env.OURA_REDIRECT_URI ?? "http://localhost:8080/callback";
const SCOPES = "email personal daily heartrate workout tag session spo2";

const AUTHORIZE_URL = "https://cloud.ouraring.com/oauth/authorize";
const TOKEN_URL = "https://api.ouraring.com/oauth/token";

async function main(): Promise<void> {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error(
      "Set OURA_CLIENT_ID and OURA_CLIENT_SECRET (e.g. in a .env file) before running this.\n" +
        "Register an app at https://cloud.ouraring.com/oauth/applications first, " +
        `using redirect URI: ${REDIRECT_URI}`
    );
    process.exit(1);
  }

  const state = crypto.randomBytes(18).toString("base64url");
  const redirect = new URL(REDIRECT_URI);
  const port = Number(redirect.port) || 8080;

  const code: string = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", REDIRECT_URI);
      const params = url.searchParams;

      res.writeHead(200, { "Content-Type": "text/html" });

      if (params.get("error")) {
        res.end("<h1>Authorization denied.</h1>You can close this tab.");
        server.close();
        reject(new Error(`Authorization failed: ${params.get("error")}`));
        return;
      }

      const returnedCode = params.get("code");
      if (returnedCode && params.get("state") === state) {
        res.end("<h1>Authorized!</h1>You can close this tab and return to the terminal.");
        server.close();
        resolve(returnedCode);
        return;
      }

      res.end("<h1>Something went wrong.</h1>Check the terminal.");
      server.close();
      reject(new Error("State mismatch or missing authorization code."));
    });

    server.listen(port, () => {
      const authUrl =
        `${AUTHORIZE_URL}?response_type=code&client_id=${CLIENT_ID}` +
        `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
        `&scope=${encodeURIComponent(SCOPES)}&state=${state}`;

      console.log(`Opening browser for Oura authorization...\nIf it doesn't open, visit:\n${authUrl}\n`);
      open(authUrl);
    });

    setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for authorization."));
    }, 180_000);
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status} ${await response.text()}`);
  }

  const tokens = await response.json();
  saveTokens(tokens);
  console.log("Success! Tokens saved to tokens.json. You can now run the server or connect it to Claude Desktop.");
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});

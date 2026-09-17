/**
 * Small helper for persisting Oura OAuth2 tokens to a local JSON file.
 *
 * Oura refresh tokens are single-use: every time you use one to get a new
 * access token, you also get a new refresh token, and the old one stops
 * working. So both authorize.ts and server.ts must overwrite tokens.json
 * every time they refresh.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Defaults to the project root (one level up from dist/ or src/). Override
// with TOKENS_PATH to point at a persistent volume in a hosted deployment
// (e.g. TOKENS_PATH=/data/tokens.json).
const TOKENS_PATH = process.env.TOKENS_PATH ?? path.join(__dirname, "..", "tokens.json");

export interface StoredTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // unix seconds, with a safety margin already subtracted
}

interface OuraTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  [key: string]: unknown;
}

export function saveTokens(tokenResponse: OuraTokenResponse): void {
  const data: StoredTokens = {
    access_token: tokenResponse.access_token,
    refresh_token: tokenResponse.refresh_token,
    expires_at: Date.now() / 1000 + (tokenResponse.expires_in ?? 0) - 60, // 60s safety margin
  };
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(data), { mode: 0o600 });
  try {
    fs.chmodSync(TOKENS_PATH, 0o600);
  } catch {
    // best-effort on platforms that support it
  }
}

export function loadTokens(): StoredTokens {
  if (!fs.existsSync(TOKENS_PATH)) {
    throw new Error(
      "No tokens found. Run `npm run authorize` (local mode) or visit /oauth/authorize " +
        "on your hosted instance to authorize this app with Oura."
    );
  }
  return JSON.parse(fs.readFileSync(TOKENS_PATH, "utf-8"));
}

export function tokensExist(): boolean {
  return fs.existsSync(TOKENS_PATH);
}

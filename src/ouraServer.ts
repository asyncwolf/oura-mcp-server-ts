/**
 * Oura MCP tool definitions.
 *
 * Shared between the stdio entrypoint (server.ts, for Claude Desktop on this
 * machine) and the HTTP entrypoint (httpServer.ts, for a hosted deployment).
 * Each call to createOuraServer() returns a fresh McpServer instance with
 * all tools registered against the same underlying Oura account.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadTokens, saveTokens, tokensExist } from "./tokenStore.js";

const OURA_API_BASE = "https://api.ouraring.com/v2/usercollection";
const TOKEN_URL = "https://api.ouraring.com/oauth/token";
const CLIENT_ID = process.env.OURA_CLIENT_ID;
const CLIENT_SECRET = process.env.OURA_CLIENT_SECRET;

function defaultDateRange(days = 7): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}

async function getValidAccessToken(): Promise<string> {
  if (!tokensExist()) {
    throw new Error(
      "Not authorized yet. Run `npm run authorize` (local mode) or visit /oauth/authorize " +
        "on your hosted instance to connect your Oura account."
    );
  }

  const tokens = loadTokens();

  if (Date.now() / 1000 < tokens.expires_at) {
    return tokens.access_token;
  }

  // Access token expired - refresh it. Oura refresh tokens are single-use,
  // so we must persist the new pair we get back.
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("OURA_CLIENT_ID / OURA_CLIENT_SECRET must be set to refresh an expired token.");
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });

  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.status} ${await response.text()}`);
  }

  const newTokens = await response.json();
  saveTokens(newTokens);
  return newTokens.access_token;
}

async function ouraGet(path: string, params: Record<string, string>): Promise<unknown> {
  const accessToken = await getValidAccessToken();
  const url = new URL(`${OURA_API_BASE}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Oura API error: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

function asToolResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

export function createOuraServer(): McpServer {
  const server = new McpServer({ name: "oura", version: "1.0.0" });

  server.registerTool(
    "get_personal_info",
    {
      title: "Get personal info",
      description: "Get the Oura account holder's basic profile info (age, weight, height, biological sex).",
      inputSchema: {},
    },
    async () => asToolResult(await ouraGet("personal_info", {}))
  );

  server.registerTool(
    "get_daily_sleep",
    {
      title: "Get daily sleep",
      description: "Get daily sleep scores and contributors (e.g. efficiency, restfulness, timing).",
      inputSchema: {
        start_date: z.string().optional().describe("ISO date (YYYY-MM-DD). Defaults to 7 days ago."),
        end_date: z.string().optional().describe("ISO date (YYYY-MM-DD). Defaults to today."),
      },
    },
    async ({ start_date, end_date }) => {
      const range = defaultDateRange();
      return asToolResult(
        await ouraGet("daily_sleep", {
          start_date: start_date ?? range.startDate,
          end_date: end_date ?? range.endDate,
        })
      );
    }
  );

  server.registerTool(
    "get_sleep_periods",
    {
      title: "Get sleep periods",
      description:
        "Get detailed sleep period data (bedtime, wake time, sleep stages, HRV, heart rate during sleep).",
      inputSchema: {
        start_date: z.string().optional().describe("ISO date (YYYY-MM-DD). Defaults to 7 days ago."),
        end_date: z.string().optional().describe("ISO date (YYYY-MM-DD). Defaults to today."),
      },
    },
    async ({ start_date, end_date }) => {
      const range = defaultDateRange();
      return asToolResult(
        await ouraGet("sleep", {
          start_date: start_date ?? range.startDate,
          end_date: end_date ?? range.endDate,
        })
      );
    }
  );

  server.registerTool(
    "get_daily_readiness",
    {
      title: "Get daily readiness",
      description:
        "Get daily readiness scores and contributors (recovery index, HRV balance, temperature deviation).",
      inputSchema: {
        start_date: z.string().optional().describe("ISO date (YYYY-MM-DD). Defaults to 7 days ago."),
        end_date: z.string().optional().describe("ISO date (YYYY-MM-DD). Defaults to today."),
      },
    },
    async ({ start_date, end_date }) => {
      const range = defaultDateRange();
      return asToolResult(
        await ouraGet("daily_readiness", {
          start_date: start_date ?? range.startDate,
          end_date: end_date ?? range.endDate,
        })
      );
    }
  );

  server.registerTool(
    "get_daily_activity",
    {
      title: "Get daily activity",
      description: "Get daily activity scores, steps, calories, and movement contributors.",
      inputSchema: {
        start_date: z.string().optional().describe("ISO date (YYYY-MM-DD). Defaults to 7 days ago."),
        end_date: z.string().optional().describe("ISO date (YYYY-MM-DD). Defaults to today."),
      },
    },
    async ({ start_date, end_date }) => {
      const range = defaultDateRange();
      return asToolResult(
        await ouraGet("daily_activity", {
          start_date: start_date ?? range.startDate,
          end_date: end_date ?? range.endDate,
        })
      );
    }
  );

  server.registerTool(
    "get_heart_rate",
    {
      title: "Get heart rate",
      description: "Get raw heart rate time-series data.",
      inputSchema: {
        start_datetime: z
          .string()
          .optional()
          .describe("ISO 8601 datetime (e.g. 2026-09-10T00:00:00-00:00). Defaults to 24 hours ago."),
        end_datetime: z.string().optional().describe("ISO 8601 datetime. Defaults to now."),
      },
    },
    async ({ start_datetime, end_datetime }) => {
      const end = end_datetime ?? new Date().toISOString();
      const start = start_datetime ?? new Date(Date.now() - 86_400_000).toISOString();
      return asToolResult(await ouraGet("heartrate", { start_datetime: start, end_datetime: end }));
    }
  );

  server.registerTool(
    "get_workouts",
    {
      title: "Get workouts",
      description: "Get logged workouts (activity type, duration, intensity, calories).",
      inputSchema: {
        start_date: z.string().optional().describe("ISO date (YYYY-MM-DD). Defaults to 30 days ago."),
        end_date: z.string().optional().describe("ISO date (YYYY-MM-DD). Defaults to today."),
      },
    },
    async ({ start_date, end_date }) => {
      const range = defaultDateRange(30);
      return asToolResult(
        await ouraGet("workout", {
          start_date: start_date ?? range.startDate,
          end_date: end_date ?? range.endDate,
        })
      );
    }
  );

  server.registerTool(
    "get_tags",
    {
      title: "Get tags",
      description: "Get enhanced tags the user logged (e.g. stress, illness, alcohol, meditation).",
      inputSchema: {
        start_date: z.string().optional().describe("ISO date (YYYY-MM-DD). Defaults to 30 days ago."),
        end_date: z.string().optional().describe("ISO date (YYYY-MM-DD). Defaults to today."),
      },
    },
    async ({ start_date, end_date }) => {
      const range = defaultDateRange(30);
      return asToolResult(
        await ouraGet("enhanced_tag", {
          start_date: start_date ?? range.startDate,
          end_date: end_date ?? range.endDate,
        })
      );
    }
  );

  return server;
}

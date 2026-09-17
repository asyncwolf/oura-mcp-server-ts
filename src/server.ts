/**
 * Oura MCP Server (stdio / local mode)
 * -------------------------------------
 * Local entrypoint for Claude Desktop: exposes your Oura Ring data (sleep,
 * readiness, activity, heart rate, workouts) as MCP tools over stdio.
 *
 * Authentication uses OAuth2 (Oura deprecated Personal Access Tokens in
 * December 2025). Run `npm run authorize` once first - see README.md.
 *
 * For a network-reachable deployment (e.g. so you don't need Claude Desktop
 * running locally), see httpServer.ts instead.
 */

import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createOuraServer } from "./ouraServer.js";

async function main(): Promise<void> {
  const server = createOuraServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

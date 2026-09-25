import type { Client } from 'discord.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registreerLeesTools } from './tools/lezen.js';
import { registreerSchrijfTools } from './tools/schrijven.js';

/**
 * Eén verse McpServer per verzoek (stateless — zie `http.ts`), met alle tools
 * erop. Verder niets: geen eigen planner, geen eigen permission-logica, geen
 * eigen allowlist. Alle tools halen dat uit bestaande modules; dit bestand
 * zet ze alleen naast elkaar.
 */
export function bouwMcpServer(client: Client<true>): McpServer {
  const server = new McpServer({ name: 'discord-setup-bot', version: '1.0.0' });

  registreerLeesTools(server, client);
  registreerSchrijfTools(server, client);

  return server;
}

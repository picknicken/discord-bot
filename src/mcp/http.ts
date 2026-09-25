import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Client } from 'discord.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { config } from '../config.js';
import { logger } from '../util/logger.js';
import { haalBearerToken, veiligGelijk } from './auth.js';
import { bouwMcpServer } from './server.js';

/**
 * De brug tussen de gewone HTTP-server van het dashboard en MCP.
 *
 * Twee sloten na elkaar, en geen van beide mag de ander vervangen:
 *  1. Hier: hoort dit verzoek er überhaupt te mogen zijn (MCP aan, geheim
 *     ingesteld, juiste Bearer-token)? Dit zegt niets over welke Discord-server
 *     de aanroeper mag gebruiken — dat bepaalt elke tool zelf, opnieuw, aan de
 *     hand van `MCP_ALLOWED_GUILD_IDS`.
 *  2. In elke tool: `haalToegestaneGuild()` / `controleerMcpToegang()`.
 *
 * Stateless met opzet (`sessionIdGenerator: undefined`): elk verzoek krijgt
 * een verse McpServer en transport. Dat scheelt sessiebeheer dat een herstart
 * of een tweede replica toch niet overleeft, en past bij hoe de rest van deze
 * bot werkt — geen toestand die belangrijker is dan de bron van waarheid zelf.
 */
export async function handleMcpRequest(
  client: Client<true>,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (!config.mcpEnabled) {
    stuurJson(response, 404, { error: 'Niet gevonden.' });
    return;
  }

  if (!config.mcpAuthToken) {
    // Aan, maar zonder geheim: dan blijft de deur dicht in plaats van open te
    // staan voor wie het maar probeert. Dit is een configuratiefout, geen
    // aanval, dus loggen en weigeren - niet de bot laten crashen.
    logger.error('MCP_ENABLED staat aan, maar MCP_AUTH_TOKEN is leeg. MCP blijft daarom dicht.');
    stuurJson(response, 503, { error: 'MCP is niet volledig ingesteld.' });
    return;
  }

  const token = haalBearerToken(request);
  if (!token || !veiligGelijk(token, config.mcpAuthToken)) {
    stuurJson(response, 401, { error: 'Niet geautoriseerd.' });
    return;
  }

  if (request.method !== 'POST') {
    response.writeHead(405, { 'content-type': 'application/json', allow: 'POST' });
    response.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null }));
    return;
  }

  const server = bouwMcpServer(client);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  response.on('close', () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(request, response);
  } catch (error) {
    logger.error('MCP-verzoek mislukt', error);
    if (!response.headersSent) {
      stuurJson(response, 500, { jsonrpc: '2.0', error: { code: -32603, message: 'Interne fout.' }, id: null });
    }
  }
}

function stuurJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

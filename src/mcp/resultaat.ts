import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/** Gewoon antwoord: het resultaat als leesbare JSON. */
export function jsonResultaat(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

/**
 * Een geweigerde of mislukte aanroep. Dezelfde generieke zin voor "server niet
 * toegestaan" als voor "server bestaat niet" - Claude mag uit het antwoord niet
 * kunnen afleiden of een niet-toegestane server wél ergens bestaat.
 */
export function foutResultaat(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** Vangt een fout van een bestaande kernfunctie en zet hem om in een tool-fout. */
export function afhandelen(werk: () => Promise<CallToolResult>): Promise<CallToolResult> {
  return werk().catch((error: unknown) =>
    foutResultaat(error instanceof Error ? error.message : String(error)),
  );
}

import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/**
 * Bewijst dat de aanroeper hoort te mogen praten met deze MCP-server. Dit is
 * iets anders dan de guild-allowlist verderop: dit zegt alleen "dit is een
 * geldige MCP-cliënt", niet "deze cliënt mag met server X praten". Die twee
 * blijven expres apart - een geldig token opent nooit vanzelf elke server.
 */
export function haalBearerToken(request: IncomingMessage): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer (.+)$/.exec(header);
  return match ? (match[1] as string) : null;
}

/** Constante tijd vergelijken, zodat een foutief token niet af te tasten is aan hoe lang het antwoord duurt. */
export function veiligGelijk(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

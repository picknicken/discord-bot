import { logger } from '../util/logger.js';

/**
 * Eén regel per schrijvende MCP-aanroep: wat, welke server, welke template
 * (als dat van toepassing is), en de uitkomst. Nooit geheimen — geen token,
 * geen confirmation, geen cookie — alleen wat je nodig hebt om achteraf te
 * zien wat Claude heeft veranderd en wanneer.
 */
export function logMcpActie(
  actie: string,
  details: {
    guildId?: string;
    templateId?: string;
    resultaat: 'gelukt' | 'geweigerd' | 'mislukt';
    wijzigingen?: number;
    reden?: string;
  },
): void {
  const stukjes = [
    `MCP ${actie}`,
    details.guildId ? `guild=${details.guildId}` : null,
    details.templateId ? `template=${details.templateId}` : null,
    `resultaat=${details.resultaat}`,
    typeof details.wijzigingen === 'number' ? `wijzigingen=${details.wijzigingen}` : null,
    details.reden ? `(${details.reden})` : null,
  ].filter(Boolean);

  logger.info(stukjes.join(' '));
}

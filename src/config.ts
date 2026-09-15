import 'dotenv/config';
import { leesToegestaneServers } from './toegestaan.js';

function required(name: string): string {
  const value = process.env[name];
  if (value) return value;

  // Een stacktrace helpt hier niemand; dit is gewoon een ontbrekende instelling.
  console.error(
    `\n  Ontbrekende instelling: ${name}\n\n` +
      '  Kopieer .env.example naar .env en vul hem in:\n' +
      '    cp .env.example .env\n\n' +
      '  Even rondkijken zonder Discord-account? Draai `npm run demo`.\n',
  );
  process.exit(1);
}

export const config = {
  token: required('DISCORD_TOKEN'),
  clientId: required('DISCORD_CLIENT_ID'),
  devGuildId: process.env.DISCORD_DEV_GUILD_ID || undefined,
  templatesDir: process.env.TEMPLATES_DIR || './templates',
  /** Weergavenaam van de bot. Wordt toegepast door `npm run configure-install`. */
  botName: process.env.BOT_NAME?.trim() || 'Setup Bot',
  /** Demo-modus: geen echte bot, dus toepassen wordt geweigerd in plaats van geprobeerd. */
  demo: process.env.DEMO === '1',
  /** Afbeelding voor de botavatar en het applicatie-icoon. */
  avatarFile: process.env.BOT_AVATAR || './assets/logo.png',
  /**
   * Poort van het dashboard. PORT is wat hostingpartijen zoals Railway zelf
   * invullen; die wint, want daar luistert hun router op.
   */
  dashboardPort: Number(process.env.PORT || process.env.DASHBOARD_PORT || 4000),
  /** Adres om op te luisteren. Alles behalve localhost vereist inloggen. */
  dashboardHost: process.env.DASHBOARD_HOST || '127.0.0.1',
  /** Client secret uit het Developer Portal; zonder dit is inloggen uitgeschakeld. */
  clientSecret: process.env.DISCORD_CLIENT_SECRET || '',
  /** Discord-gebruikers-ids die binnen mogen. Leeg = alleen de eigenaar van de applicatie. */
  dashboardOwners: (process.env.DASHBOARD_OWNERS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
  /** Basis-URL waarop het dashboard bereikbaar is; moet in het portal staan als redirect. */
  dashboardUrl: (process.env.DASHBOARD_URL || `http://127.0.0.1:${process.env.DASHBOARD_PORT ?? 4000}`)
    .replace(/\/$/, ''),
  /** Momentopnames van servers, weggeschreven voor elk toepassen. */
  backupsDir: process.env.BACKUPS_DIR || './backups',
  /** Vorige versies van templates, bijgehouden door het dashboard. */
  historyDir: process.env.HISTORY_DIR || './history',
  /**
   * Server-ids waar deze installatie iets mag. Leeg = geen beperking.
   * Vooral voor GitHub Actions: daar is het server-id een invoerveld.
   */
  toegestaneServers: leesToegestaneServers(process.env.GUILD_IDS),
};

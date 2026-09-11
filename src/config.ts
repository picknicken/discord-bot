import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Ontbrekende environment variable: ${name}. Kopieer .env.example naar .env en vul hem in.`);
  }
  return value;
}

export const config = {
  token: required('DISCORD_TOKEN'),
  clientId: required('DISCORD_CLIENT_ID'),
  devGuildId: process.env.DISCORD_DEV_GUILD_ID || undefined,
  templatesDir: process.env.TEMPLATES_DIR || './templates',
  /** Weergavenaam van de bot. Wordt toegepast door `npm run configure-install`. */
  botName: process.env.BOT_NAME?.trim() || 'Setup Bot',
  /** Afbeelding voor de botavatar en het applicatie-icoon. */
  avatarFile: process.env.BOT_AVATAR || './assets/logo.png',
  /** Poort van het dashboard. */
  dashboardPort: Number(process.env.DASHBOARD_PORT ?? 4000),
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
};

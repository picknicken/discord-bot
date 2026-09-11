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
  /** Poort van het lokale dashboard. Luistert alleen op 127.0.0.1. */
  dashboardPort: Number(process.env.DASHBOARD_PORT ?? 4000),
};

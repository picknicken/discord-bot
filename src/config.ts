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
};

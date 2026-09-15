import { describe, expect, it } from 'vitest';

/**
 * Een enter achter een variabele is onzichtbaar in elk instellingenscherm, maar
 * gaat wel mee de URL in. Dat kostte een avond zoeken: Discord zei "Ongeldige
 * OAuth2 redirect_uri" terwijl het adres er in het portal precies hetzelfde
 * uitzag. Het verschil was een regeleinde vlak voor /auth/callback.
 */
process.env.DISCORD_TOKEN = '  een-token-met-spaties  ';
process.env.DISCORD_CLIENT_ID = '123456789\n';
process.env.DISCORD_CLIENT_SECRET = ' geheim\n';
process.env.DASHBOARD_URL = 'https://discord-bot-production-bdfc.up.railway.app\n';
process.env.DASHBOARD_HOST = '0.0.0.0\n';
process.env.TEMPLATES_DIR = ' ./templates ';
process.env.BOT_NAME = '"Setup Bot"';

const { config } = await import('../src/config.js');

describe('spaties en enters rond variabelen', () => {
  it('haalt het regeleinde uit de dashboard-URL', () => {
    expect(config.dashboardUrl).toBe('https://discord-bot-production-bdfc.up.railway.app');
    expect(`${config.dashboardUrl}/auth/callback`).toBe(
      'https://discord-bot-production-bdfc.up.railway.app/auth/callback',
    );
  });

  it('poetst ook de rest, want die tekens gaan overal mee', () => {
    expect(config.token).toBe('een-token-met-spaties');
    expect(config.clientId).toBe('123456789');
    expect(config.clientSecret).toBe('geheim');
    expect(config.dashboardHost).toBe('0.0.0.0');
    expect(config.templatesDir).toBe('./templates');
  });

  it('haalt aanhalingstekens weg die mensen er zelf omheen zetten', () => {
    expect(config.botName).toBe('Setup Bot');
  });
});

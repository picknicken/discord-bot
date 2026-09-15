import { describe, expect, it } from 'vitest';

/**
 * Hostingpartijen (Railway, Render, Fly) geven zelf een poort door in PORT en
 * sturen het verkeer daarheen. Luistert het dashboard op een andere poort, dan
 * krijgt de bezoeker niets te zien.
 */
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = '123456789';
process.env.PORT = '8080';
process.env.DASHBOARD_PORT = '4000';

const { config } = await import('../src/config.js');

describe('poort van het dashboard', () => {
  it('volgt PORT van de hosting, ook als DASHBOARD_PORT iets anders zegt', () => {
    expect(config.dashboardPort).toBe(8080);
  });
});

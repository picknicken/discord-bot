import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApplicationFlagsBitField, GatewayIntentBits } from 'discord.js';
import { berichtIntentAan, kiesIntents, ledenIntentAan } from '../src/util/intents.js';

/**
 * Vraag je de Server Members Intent aan terwijl hij in het Developer Portal
 * uitstaat, dan weigert Discord de héle inlog. Daarom kijken we eerst of het
 * mag — en is "ik weet het niet" hetzelfde als "niet vragen".
 */
const antwoord = (waarde: unknown, status = 200): typeof fetch =>
  (async () => new Response(JSON.stringify(waarde), { status })) as unknown as typeof fetch;

describe('mag de bot leden zien?', () => {
  it('ja, bij een bot onder de honderd servers met de schakelaar aan', async () => {
    const flags = ApplicationFlagsBitField.Flags.GatewayGuildMembersLimited;
    expect(await ledenIntentAan('token', antwoord({ flags: Number(flags) }))).toBe(true);
  });

  it('ja, bij een goedgekeurde bot', async () => {
    const flags = ApplicationFlagsBitField.Flags.GatewayGuildMembers;
    expect(await ledenIntentAan('token', antwoord({ flags: Number(flags) }))).toBe(true);
  });

  it('nee, met de schakelaar uit', async () => {
    expect(await ledenIntentAan('token', antwoord({ flags: 0 }))).toBe(false);
  });

  it('nee bij een token die Discord niet accepteert', async () => {
    expect(await ledenIntentAan('token', antwoord({}, 401))).toBe(false);
  });

  it('nee als Discord niet bereikbaar is — de bot start dan gewoon', async () => {
    const stuk = (async () => {
      throw new Error('fetch failed');
    }) as unknown as typeof fetch;

    expect(await ledenIntentAan('token', stuk)).toBe(false);
  });
});

describe('mag de bot berichten lezen?', () => {
  it('ja met de schakelaar aan', async () => {
    const flags = ApplicationFlagsBitField.Flags.GatewayMessageContentLimited;
    expect(await berichtIntentAan('token', antwoord({ flags: Number(flags) }))).toBe(true);
  });

  it('nee met de schakelaar uit', async () => {
    expect(await berichtIntentAan('token', antwoord({ flags: 0 }))).toBe(false);
  });
});

describe('welke intents de bot aanvraagt', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('vraagt beide privileged intents met allebei de schakelaars aan', async () => {
    const flags =
      Number(ApplicationFlagsBitField.Flags.GatewayGuildMembers) |
      Number(ApplicationFlagsBitField.Flags.GatewayMessageContent);
    vi.stubGlobal('fetch', antwoord({ flags }));

    const intents = await kiesIntents('token');
    expect(intents).toEqual(
      expect.arrayContaining([GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers, GatewayIntentBits.MessageContent]),
    );
  });

  it('laat allebei weg met allebei de schakelaars uit, en start toch', async () => {
    vi.stubGlobal('fetch', antwoord({ flags: 0 }));

    const intents = await kiesIntents('token');
    expect(intents).toEqual([GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]);
  });
});

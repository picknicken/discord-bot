import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, afterAll } from 'vitest';

const werkmap = mkdtempSync(path.join(tmpdir(), 'setup-bot-embed-'));

process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = '123456789';
process.env.GUILD_IDS = '987654321';
process.env.HISTORY_DIR = path.join(werkmap, 'history');

const { execute } = await import('../src/commands/embed.js');
const { leesGeplandeAankondigingen } = await import('../src/geplandeAankondiging.js');

afterAll(() => rmSync(werkmap, { recursive: true, force: true }));

interface StubOpties {
  subcommand?: string;
  titel?: string;
  beschrijving?: string;
  kleur?: string;
  afbeelding?: string;
  thumbnail?: string;
  footer?: string;
  over?: number;
  eenheid?: string;
  heeftManageMessages?: boolean;
  volledigeKanaalRechten?: boolean;
  kanaalIsTextBased?: boolean;
  kanaalOntbreekt?: boolean;
  stuurMislukt?: boolean;
}

/** Een minimale nepinteractie: alleen wat execute() ervan gebruikt. */
function stubInteractie(opties: StubOpties) {
  const antwoorden: unknown[] = [];
  const verstuurd: unknown[] = [];

  const kanaal = opties.kanaalOntbreekt
    ? null
    : {
        id: 'kanaal-1',
        isTextBased: () => opties.kanaalIsTextBased ?? true,
        toString: () => '#algemeen',
        permissionsFor: () => ({ has: () => opties.volledigeKanaalRechten ?? true }),
        send: async (bericht: unknown) => {
          if (opties.stuurMislukt) throw new Error('geen toegang');
          verstuurd.push(bericht);
        },
      };

  const waarden: Record<string, string | undefined> = {
    titel: opties.titel,
    beschrijving: opties.beschrijving,
    kleur: opties.kleur,
    afbeelding: opties.afbeelding,
    thumbnail: opties.thumbnail,
    footer: opties.footer,
    eenheid: opties.eenheid,
  };

  return {
    antwoorden,
    verstuurd,
    interactie: {
      locale: 'nl',
      guildId: '987654321',
      user: { tag: 'tester#0001' },
      inGuild: () => true,
      guild: { members: { me: {} } },
      memberPermissions: { has: () => opties.heeftManageMessages ?? true },
      channel: kanaal,
      options: {
        getSubcommand: () => opties.subcommand ?? 'stuur',
        getString: (naam: string) => waarden[naam] ?? null,
        getInteger: () => opties.over ?? null,
        getChannel: () => null,
      },
      reply: async (bericht: unknown) => {
        antwoorden.push(bericht);
      },
    },
  };
}

describe('/embed stuur', () => {
  it('stuurt de embed als los bericht, en bevestigt dat ephemeral', async () => {
    const { interactie, antwoorden, verstuurd } = stubInteractie({
      titel: 'Aankondiging',
      beschrijving: 'De tekst',
      kleur: '#5865F2',
      footer: 'Groetjes',
    });

    await execute(interactie as never);

    expect(verstuurd).toHaveLength(1);
    const bericht = verstuurd[0] as { embeds: { data: { title?: string; description?: string; color?: number; footer?: { text: string } } }[] };
    expect(bericht.embeds[0]?.data.title).toBe('Aankondiging');
    expect(bericht.embeds[0]?.data.description).toBe('De tekst');
    expect(bericht.embeds[0]?.data.color).toBe(0x5865f2);
    expect(bericht.embeds[0]?.data.footer?.text).toBe('Groetjes');

    expect(antwoorden).toHaveLength(1);
    expect((antwoorden[0] as { content: string }).content).toMatch(/geplaatst/);
  });

  it('weigert een lege embed', async () => {
    const { interactie, antwoorden, verstuurd } = stubInteractie({});

    await execute(interactie as never);

    expect(verstuurd).toHaveLength(0);
    expect((antwoorden[0] as { content: string }).content).toMatch(/titel of een beschrijving/);
  });

  it('weigert een ongeldige hexkleur', async () => {
    const { interactie, antwoorden } = stubInteractie({ titel: 'X', kleur: 'nietprima' });

    await execute(interactie as never);

    expect((antwoorden[0] as { content: string }).content).toMatch(/geldige hexkleur/);
  });

  it('weigert een ongeldige afbeeldingslink', async () => {
    const { interactie, antwoorden } = stubInteractie({ titel: 'X', afbeelding: 'niet-een-url' });

    await execute(interactie as never);

    expect((antwoorden[0] as { content: string }).content).toMatch(/geldige http/);
  });

  it('werkt alleen in een server', async () => {
    const { interactie, antwoorden } = stubInteractie({ titel: 'X' });
    interactie.inGuild = () => false;

    await execute(interactie as never);

    expect((antwoorden[0] as { content: string }).content).toMatch(/alleen in een server/);
  });

  it('weigert zonder het recht "Berichten beheren"', async () => {
    const { interactie, antwoorden, verstuurd } = stubInteractie({ titel: 'X', heeftManageMessages: false });

    await execute(interactie as never);

    expect(verstuurd).toHaveLength(0);
    expect((antwoorden[0] as { content: string }).content).toMatch(/Berichten beheren/);
  });

  it('weigert een server die niet in de lijst staat', async () => {
    const { interactie, antwoorden } = stubInteractie({ titel: 'X' });
    interactie.guildId = '111111111';

    await execute(interactie as never);

    expect((antwoorden[0] as { content: string }).content).toMatch(/niet in de lijst/);
  });

  it('weigert als het kanaal niet tekstgebaseerd is', async () => {
    const { interactie, antwoorden } = stubInteractie({ titel: 'X', kanaalIsTextBased: false });

    await execute(interactie as never);

    expect((antwoorden[0] as { content: string }).content).toMatch(/tekst- of aankondigingskanaal/);
  });

  it('weigert zonder rechten van de bot in dat kanaal', async () => {
    const { interactie, antwoorden, verstuurd } = stubInteractie({ titel: 'X', volledigeKanaalRechten: false });

    await execute(interactie as never);

    expect(verstuurd).toHaveLength(0);
    expect((antwoorden[0] as { content: string }).content).toMatch(/mag niet praten in/);
  });

  it('meldt het netjes als versturen mislukt', async () => {
    const { interactie, antwoorden } = stubInteractie({ titel: 'X', stuurMislukt: true });

    await execute(interactie as never);

    expect((antwoorden[0] as { content: string }).content).toMatch(/geen toegang/);
  });
});

describe('/embed plan', () => {
  it('zet de aankondiging klaar en bevestigt met een tijdstip', async () => {
    const { interactie, antwoorden, verstuurd } = stubInteractie({
      subcommand: 'plan',
      titel: 'Onderhoud',
      over: 2,
      eenheid: 'uren',
    });

    await execute(interactie as never);

    expect(verstuurd).toHaveLength(0);
    expect((antwoorden[0] as { content: string }).content).toMatch(/<t:\d+:f>/);

    const lijst = await leesGeplandeAankondigingen(path.join(werkmap, 'history'));
    expect(lijst).toHaveLength(1);
    expect(lijst[0]?.titel).toBe('Onderhoud');
    expect(lijst[0]?.guildId).toBe('987654321');
    expect(lijst[0]?.channelId).toBe('kanaal-1');
  });

  it('weigert een onbekende eenheid', async () => {
    const { interactie, antwoorden } = stubInteractie({
      subcommand: 'plan',
      titel: 'X',
      over: 2,
      eenheid: 'weken',
    });

    await execute(interactie as never);

    expect((antwoorden[0] as { content: string }).content).toMatch(/Onbekende eenheid/);
  });

  it('weigert te ver in de toekomst', async () => {
    const { interactie, antwoorden } = stubInteractie({
      subcommand: 'plan',
      titel: 'X',
      over: 1000,
      eenheid: 'dagen',
    });

    await execute(interactie as never);

    expect((antwoorden[0] as { content: string }).content).toMatch(/te ver vooruit/);
  });
});

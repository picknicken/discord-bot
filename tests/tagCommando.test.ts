import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const werkmap = mkdtempSync(path.join(tmpdir(), 'setup-bot-tags-'));

process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = '123456789';
process.env.GUILD_IDS = '987654321';
process.env.TAGS_DIR = werkmap;

const { execute, autocomplete } = await import('../src/commands/tag.js');

afterAll(() => rmSync(werkmap, { recursive: true, force: true }));

interface StubOpties {
  subcommand: string;
  naam?: string;
  tekst?: string;
  titel?: string;
  beschrijving?: string;
  kleur?: string;
  afbeelding?: string;
  heeftManageMessages?: boolean;
}

function stubInteractie(opties: StubOpties) {
  const antwoorden: unknown[] = [];

  const waarden: Record<string, string | undefined> = {
    naam: opties.naam,
    tekst: opties.tekst,
    titel: opties.titel,
    beschrijving: opties.beschrijving,
    kleur: opties.kleur,
    afbeelding: opties.afbeelding,
  };

  return {
    antwoorden,
    interactie: {
      locale: 'nl',
      guildId: '987654321',
      inGuild: () => true,
      user: { tag: 'tester#0001' },
      memberPermissions: { has: () => opties.heeftManageMessages ?? true },
      options: {
        getSubcommand: () => opties.subcommand,
        getString: (naam: string, verplicht?: boolean) => {
          const waarde = waarden[naam] ?? null;
          if (verplicht && waarde === null) throw new Error(`ontbrekende optie ${naam}`);
          return waarde;
        },
      },
      reply: async (bericht: unknown) => {
        antwoorden.push(bericht);
      },
    },
  };
}

describe('/tag maak en /tag toon', () => {
  it('maakt een tekst-tag aan en toont hem weer', async () => {
    const { interactie: maakInteractie, antwoorden: maakAntwoorden } = stubInteractie({
      subcommand: 'maak',
      naam: 'Regels',
      tekst: 'Wees aardig tegen elkaar.',
    });

    await execute(maakInteractie as never);

    expect((maakAntwoorden[0] as { content: string }).content).toMatch(/aangemaakt/);

    const { interactie: toonInteractie, antwoorden: toonAntwoorden } = stubInteractie({
      subcommand: 'toon',
      naam: 'regels',
    });

    await execute(toonInteractie as never);

    expect(toonAntwoorden).toEqual([{ content: 'Wees aardig tegen elkaar.', embeds: [] }]);
  });

  it('normaliseert de naam (hoofdletters, spaties)', async () => {
    const { interactie, antwoorden } = stubInteractie({
      subcommand: 'maak',
      naam: 'Server Regels',
      tekst: 'x',
    });

    await execute(interactie as never);

    expect((antwoorden[0] as { content: string }).content).toMatch(/"server-regels"/);
  });

  it('weigert een tag zonder inhoud', async () => {
    const { interactie, antwoorden } = stubInteractie({ subcommand: 'maak', naam: 'leeg' });

    await execute(interactie as never);

    expect((antwoorden[0] as { content: string }).content).toMatch(/tekst, een titel of een beschrijving/);
  });

  it('weigert een ongeldige naam', async () => {
    const { interactie, antwoorden } = stubInteractie({ subcommand: 'maak', naam: 'niet geldig!', tekst: 'x' });

    await execute(interactie as never);

    expect((antwoorden[0] as { content: string }).content).toMatch(/kleine letters, cijfers en streepjes/);
  });

  it('weigert een tag die al bestaat', async () => {
    await execute(stubInteractie({ subcommand: 'maak', naam: 'dubbel', tekst: 'x' }).interactie as never);
    const { interactie, antwoorden } = stubInteractie({ subcommand: 'maak', naam: 'dubbel', tekst: 'y' });

    await execute(interactie as never);

    expect((antwoorden[0] as { content: string }).content).toMatch(/bestaat al/);
  });

  it('toont een embed als er titel- of beschrijvingvelden zijn', async () => {
    await execute(
      stubInteractie({ subcommand: 'maak', naam: 'aankondiging', titel: 'Hallo', beschrijving: 'Wereld' })
        .interactie as never,
    );

    const { interactie, antwoorden } = stubInteractie({ subcommand: 'toon', naam: 'aankondiging' });
    await execute(interactie as never);

    const bericht = antwoorden[0] as { embeds: { data: { title?: string; description?: string } }[] };
    expect(bericht.embeds[0]?.data.title).toBe('Hallo');
    expect(bericht.embeds[0]?.data.description).toBe('Wereld');
  });

  it('weigert /tag maak zonder het recht "Berichten beheren"', async () => {
    const { interactie, antwoorden } = stubInteractie({
      subcommand: 'maak',
      naam: 'zonderrecht',
      tekst: 'x',
      heeftManageMessages: false,
    });

    await execute(interactie as never);

    expect((antwoorden[0] as { content: string }).content).toMatch(/Berichten beheren/);
  });

  it('meldt een onbekende tag bij /tag toon', async () => {
    const { interactie, antwoorden } = stubInteractie({ subcommand: 'toon', naam: 'onbestaand' });

    await execute(interactie as never);

    expect((antwoorden[0] as { content: string }).content).toMatch(/bestaat niet/);
  });
});

describe('/tag bewerk en /tag verwijder', () => {
  it('weigert bewerken van een tag die niet bestaat', async () => {
    const { interactie, antwoorden } = stubInteractie({ subcommand: 'bewerk', naam: 'nooitgemaakt', tekst: 'x' });

    await execute(interactie as never);

    expect((antwoorden[0] as { content: string }).content).toMatch(/bestaat niet/);
  });

  it('vervangt de inhoud van een bestaande tag', async () => {
    await execute(stubInteractie({ subcommand: 'maak', naam: 'wijzig', tekst: 'oud' }).interactie as never);

    const { interactie, antwoorden } = stubInteractie({ subcommand: 'bewerk', naam: 'wijzig', tekst: 'nieuw' });
    await execute(interactie as never);
    expect((antwoorden[0] as { content: string }).content).toMatch(/bijgewerkt/);

    const { interactie: toonInteractie, antwoorden: toonAntwoorden } = stubInteractie({
      subcommand: 'toon',
      naam: 'wijzig',
    });
    await execute(toonInteractie as never);
    expect((toonAntwoorden[0] as { content: string }).content).toBe('nieuw');
  });

  it('verwijdert een tag', async () => {
    await execute(stubInteractie({ subcommand: 'maak', naam: 'weg', tekst: 'x' }).interactie as never);

    const { interactie, antwoorden } = stubInteractie({ subcommand: 'verwijder', naam: 'weg' });
    await execute(interactie as never);
    expect((antwoorden[0] as { content: string }).content).toMatch(/verwijderd/);

    const { interactie: toonInteractie, antwoorden: toonAntwoorden } = stubInteractie({
      subcommand: 'toon',
      naam: 'weg',
    });
    await execute(toonInteractie as never);
    expect((toonAntwoorden[0] as { content: string }).content).toMatch(/bestaat niet/);
  });
});

describe('/tag lijst en autocomplete', () => {
  it('somt de tags van deze server op', async () => {
    await execute(stubInteractie({ subcommand: 'maak', naam: 'lijsttag', tekst: 'x' }).interactie as never);

    const { interactie, antwoorden } = stubInteractie({ subcommand: 'lijst' });
    await execute(interactie as never);

    expect((antwoorden[0] as { content: string }).content).toMatch(/lijsttag/);
  });

  it('vult namen aan die overeenkomen met wat getypt is', async () => {
    await execute(stubInteractie({ subcommand: 'maak', naam: 'autoregels', tekst: 'x' }).interactie as never);

    const reacties: unknown[] = [];
    const interactie = {
      inGuild: () => true,
      guildId: '987654321',
      options: { getFocused: () => 'auto' },
      respond: async (opties: unknown) => {
        reacties.push(opties);
      },
    };

    await autocomplete(interactie as never);

    expect(reacties[0]).toEqual(expect.arrayContaining([{ name: 'autoregels', value: 'autoregels' }]));
  });
});

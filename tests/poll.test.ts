import { describe, expect, it, vi } from 'vitest';

process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = '123456789';
process.env.GUILD_IDS = '987654321';

const { verwerkOpties, execute } = await import('../src/commands/poll.js');

/**
 * /poll bouwt geen eigen stemsysteem; het zet alleen de ingebouwde Discord-poll
 * klaar. Wat hier getoetst wordt is dus vooral: de komma-gescheiden opties
 * netjes uit elkaar halen, en zeggen waarom het niet kan in plaats van het
 * gewoon aan Discord over te laten.
 */
describe('opties uit elkaar halen', () => {
  it('splitst op komma en trimt spaties', () => {
    const uitkomst = verwerkOpties('nl', ' Ja , Nee ,  Misschien');
    expect(uitkomst).toEqual({ opties: ['Ja', 'Nee', 'Misschien'] });
  });

  it('weigert minder dan twee opties', () => {
    expect(verwerkOpties('nl', 'Alleen dit')).toEqual({ fout: expect.stringMatching(/minstens 2/) });
    expect(verwerkOpties('en', 'Only this')).toEqual({ fout: expect.stringMatching(/at least 2/) });
  });

  it('negeert lege stukjes tussen komma\'s', () => {
    expect(verwerkOpties('nl', 'Ja,,Nee')).toEqual({ opties: ['Ja', 'Nee'] });
  });

  it('weigert meer dan tien opties', () => {
    const elf = Array.from({ length: 11 }, (_, i) => `optie${i}`).join(',');
    expect(verwerkOpties('nl', elf)).toEqual({ fout: expect.stringMatching(/maximaal 10/) });
  });

  it('weigert een optie langer dan 55 tekens', () => {
    const lang = 'a'.repeat(56);
    const uitkomst = verwerkOpties('nl', `Ja,Nee,${lang}`);
    expect(uitkomst).toEqual({ fout: expect.stringContaining(lang) });
  });

  it('weigert twee gelijke opties, ongeacht hoofdletters', () => {
    expect(verwerkOpties('nl', 'Ja,JA')).toEqual({ fout: expect.stringMatching(/twee keer/) });
  });
});

/** Een minimale nepinteractie: alleen wat execute() ervan gebruikt. */
function stubInteractie(opties: { vraag?: string; opties?: string; duur?: number; meerkeuze?: boolean }) {
  const antwoorden: unknown[] = [];
  return {
    antwoorden,
    interactie: {
      locale: 'nl',
      guildId: '987654321',
      inGuild: () => true,
      options: {
        getString: (naam: string) => (naam === 'vraag' ? (opties.vraag ?? 'Vraag?') : (opties.opties ?? 'Ja,Nee')),
        getInteger: () => opties.duur ?? null,
        getBoolean: () => opties.meerkeuze ?? null,
      },
      reply: async (bericht: unknown) => {
        antwoorden.push(bericht);
      },
    },
  };
}

describe('het commando', () => {
  it('plaatst de poll als het gewone, zichtbare antwoord', async () => {
    const { interactie, antwoorden } = stubInteractie({ vraag: 'Pizza of pasta?', opties: 'Pizza, Pasta' });

    await execute(interactie as never);

    expect(antwoorden).toHaveLength(1);
    const bericht = antwoorden[0] as { poll: { question: { text: string }; answers: { text: string }[]; duration: number; allowMultiselect: boolean } };
    expect(bericht.poll.question.text).toBe('Pizza of pasta?');
    expect(bericht.poll.answers).toEqual([{ text: 'Pizza' }, { text: 'Pasta' }]);
    expect(bericht.poll.duration).toBe(24);
    expect(bericht.poll.allowMultiselect).toBe(false);
  });

  it('geeft de gekozen duur en meerkeuze door', async () => {
    const { interactie, antwoorden } = stubInteractie({ duur: 4, meerkeuze: true });

    await execute(interactie as never);

    const bericht = antwoorden[0] as { poll: { duration: number; allowMultiselect: boolean } };
    expect(bericht.poll.duration).toBe(4);
    expect(bericht.poll.allowMultiselect).toBe(true);
  });

  it('weigert ongeldige opties zonder Discord erbij te halen', async () => {
    const { interactie, antwoorden } = stubInteractie({ opties: 'Alleen dit' });

    await execute(interactie as never);

    expect(antwoorden).toHaveLength(1);
    expect((antwoorden[0] as { content: string; flags: number }).content).toMatch(/minstens 2/);
  });

  it('werkt alleen in een server', async () => {
    const { interactie, antwoorden } = stubInteractie({});
    interactie.inGuild = () => false;

    await execute(interactie as never);

    expect((antwoorden[0] as { content: string }).content).toMatch(/alleen in een server/);
  });

  it('weigert een server die niet in de lijst staat', async () => {
    const { interactie, antwoorden } = stubInteractie({});
    interactie.guildId = '111111111';

    await execute(interactie as never);

    expect((antwoorden[0] as { content: string }).content).toMatch(/niet in de lijst/);
  });

  it('meldt het netjes als Discord de poll weigert', async () => {
    const { interactie, antwoorden } = stubInteractie({});
    interactie.reply = vi.fn()
      .mockRejectedValueOnce(new Error('duur te lang'))
      .mockImplementationOnce(async (bericht: unknown) => void antwoorden.push(bericht));

    await execute(interactie as never);

    expect((antwoorden[0] as { content: string }).content).toMatch(/duur te lang/);
  });
});

import { describe, expect, it } from 'vitest';
import {
  beschrijf,
  meldCommandosAan,
  watVerandert,
  zelfde,
  type CommandoJSON,
  type CommandoKoppeling,
} from '../src/commandos.js';

/**
 * De bot meldt zijn commando's zelf aan, maar alleen als er iets veranderd is:
 * Discord staat tweehonderd wijzigingen per dag toe, en een bot die bij elke
 * herstart opnieuw aanmeldt loopt daar een keer op stuk.
 */

const setup: CommandoJSON = {
  name: 'setup',
  description: 'Richt de server in',
  options: [
    { name: 'preview', description: 'Laat zien wat er zou gebeuren', type: 1, options: [{ name: 'template', description: 'welke', type: 3, required: true }] },
  ],
};

/** Zoals Discord het teruggeeft: met extra velden, en zonder wat standaard is. */
const vanDiscord = (extra: Record<string, unknown> = {}): CommandoJSON => ({
  id: '123',
  application_id: '456',
  version: '789',
  name: 'setup',
  description: 'Richt de server in',
  description_localizations: null,
  dm_permission: true,
  options: [
    {
      name: 'preview',
      description: 'Laat zien wat er zou gebeuren',
      type: 1,
      options: [{ name: 'template', description: 'welke', type: 3, required: true }],
    },
  ],
  ...extra,
});

describe('staat het al goed bij Discord?', () => {
  it('trekt zich niets aan van velden die Discord er zelf bij verzint', () => {
    expect(zelfde([setup], [vanDiscord()])).toBe(true);
  });

  it('ziet een gewijzigde omschrijving wel', () => {
    expect(zelfde([setup], [vanDiscord({ description: 'Iets anders' })])).toBe(false);
  });

  it('ziet een commando dat erbij komt', () => {
    expect(zelfde([setup, { name: 'clan', description: 'Clanrangen' }], [vanDiscord()])).toBe(false);
  });

  it('trekt zich niets aan van de volgorde', () => {
    const clan: CommandoJSON = { name: 'clan', description: 'Clanrangen' };
    expect(zelfde([setup, clan], [clan, vanDiscord()])).toBe(true);
  });

  it('ziet een subcommando dat een optie kwijt is', () => {
    const zonder = vanDiscord({
      options: [{ name: 'preview', description: 'Laat zien wat er zou gebeuren', type: 1, options: [] }],
    });
    expect(zelfde([setup], [zonder])).toBe(false);
  });
});

describe('vertaalde namen', () => {
  const vertaald: CommandoJSON = {
    ...setup,
    options: [
      {
        name: 'preview',
        description: 'Laat zien wat er zou gebeuren',
        type: 1,
        name_localizations: { 'en-US': 'preview' },
        options: [{ name: 'template', description: 'welke', type: 3, required: true }],
      },
    ],
  };

  it('ziet het als er vertalingen bij komen', () => {
    // Anders blijft /clan koppel bij Discord staan terwijl wij /clan link
    // bedoelen, en merkt niemand dat de vertaling nooit is aangekomen.
    expect(zelfde([vertaald], [vanDiscord()])).toBe(false);
  });

  it('trekt zich niets aan van de volgorde van de talen', () => {
    const anders: CommandoJSON = {
      ...vertaald,
      options: [
        {
          ...(vertaald['options'] as Record<string, unknown>[])[0],
          name_localizations: { 'en-GB': 'preview', 'en-US': 'preview' },
        },
      ],
    };
    const zelfdeAndersOm: CommandoJSON = {
      ...vertaald,
      options: [
        {
          ...(vertaald['options'] as Record<string, unknown>[])[0],
          name_localizations: { 'en-US': 'preview', 'en-GB': 'preview' },
        },
      ],
    };

    expect(zelfde([anders], [zelfdeAndersOm])).toBe(true);
  });

  it('ziet geen vertalingen en een lege lijst als hetzelfde', () => {
    const leeg: CommandoJSON = { ...setup, description_localizations: {} };
    expect(zelfde([leeg], [vanDiscord()])).toBe(true);
  });

  it('vraagt de vertalingen op bij Discord', async () => {
    const gevraagd: string[] = [];
    const koppeling: CommandoKoppeling = {
      get: async (route) => {
        gevraagd.push(route);
        return [vanDiscord()];
      },
      put: async () => [],
    };

    await meldCommandosAan(koppeling, '/commands', [setup]);
    expect(gevraagd[0]).toContain('with_localizations=true');
  });
});

describe('wat er verandert', () => {
  it('noemt wat nieuw is, wat anders is en wat weggaat', () => {
    const verschil = watVerandert(
      [setup, { name: 'clan', description: 'Clanrangen' }],
      [vanDiscord({ description: 'Oud' }), { name: 'oud', description: 'Weg' }],
    );

    expect(verschil).toEqual({ erbij: ['clan'], weg: ['oud'], anders: ['setup'] });
    expect(beschrijf(verschil)).toBe('nieuw: /clan · gewijzigd: /setup · weg: /oud');
  });

  it('zegt het ook als er niets verandert', () => {
    expect(beschrijf(watVerandert([setup], [vanDiscord()]))).toBe('niets veranderd');
  });
});

/** Een Discord dat onthoudt wat je erheen stuurt. */
function nepDiscord(staat: CommandoJSON[]) {
  const verstuurd: CommandoJSON[][] = [];

  const koppeling: CommandoKoppeling = {
    get: async () => staat,
    put: async (_route, body) => {
      verstuurd.push(body);
      staat = body;
      return body;
    },
  };

  return { koppeling, verstuurd };
}

describe('aanmelden', () => {
  it('stuurt niets als het al klopt', async () => {
    const nep = nepDiscord([vanDiscord()]);
    const uitkomst = await meldCommandosAan(nep.koppeling, '/commands', [setup]);

    expect(uitkomst.aangemeld).toBe(false);
    expect(uitkomst.uitleg).toBe('stonden al goed');
    expect(nep.verstuurd).toEqual([]);
  });

  it('stuurt wel als er iets veranderd is', async () => {
    const nep = nepDiscord([vanDiscord({ description: 'Oud' })]);
    const uitkomst = await meldCommandosAan(nep.koppeling, '/commands', [setup]);

    expect(uitkomst.aangemeld).toBe(true);
    expect(uitkomst.uitleg).toContain('gewijzigd');
    expect(nep.verstuurd).toHaveLength(1);
  });

  it('stuurt altijd als iemand er bewust om vraagt', async () => {
    const nep = nepDiscord([vanDiscord()]);
    const uitkomst = await meldCommandosAan(nep.koppeling, '/commands', [setup], { altijd: true });

    expect(uitkomst.aangemeld).toBe(true);
    expect(nep.verstuurd).toHaveLength(1);
  });

  it('kan de lijst leegmaken, zoals bij het opruimen van kopieën in een server', async () => {
    const nep = nepDiscord([vanDiscord()]);
    await meldCommandosAan(nep.koppeling, '/servers/1/commands', [], { altijd: true });

    expect(nep.verstuurd).toEqual([[]]);
  });

  it('redt zich met een Discord dat niets teruggeeft', async () => {
    const koppeling: CommandoKoppeling = { get: async () => null, put: async () => null };
    const uitkomst = await meldCommandosAan(koppeling, '/commands', [setup]);

    expect(uitkomst.aangemeld).toBe(true);
    expect(uitkomst.commandos).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import type { Message } from 'discord.js';
import { bouwRolmenu, emojiNaam, leesRolmenu, optieLabel, rolmenuGelijk, type RolmenuOptie } from '../src/rolmenu.js';
import { watVerandert, waaromNiet } from '../src/rolmenuKlik.js';
import { lintTemplate } from '../src/lint.js';
import { parseTemplate, type RoleMenuSpec } from '../src/types.js';

/**
 * Een bericht met knoppen waarmee leden zichzelf een rol geven. De bot houdt het
 * bij, dus hij moet zijn eigen bericht kunnen teruglezen en kunnen zien of het
 * nog klopt.
 */

const menuUit = (extra: Record<string, unknown> = {}): RoleMenuSpec => {
  const template = parseTemplate({
    name: 'Test',
    roles: [
      { key: 'pc', name: 'PC' },
      { key: 'console', name: 'Console' },
    ],
    uncategorizedChannels: [{ name: 'rollen' }],
    roleMenus: [
      {
        channel: 'rollen',
        title: 'Waar speel je op?',
        description: 'Klik maar.',
        options: [
          { role: 'pc', emoji: '🖥️' },
          { role: 'console', label: 'Console', description: 'PlayStation of Xbox' },
        ],
        ...extra,
      },
    ],
  });
  return template.roleMenus[0]!;
};

const opties: RolmenuOptie[] = [
  { roleId: '100', label: 'PC', emoji: '🖥️', description: null },
  { roleId: '200', label: 'Console', emoji: null, description: 'PlayStation of Xbox' },
];

/** Van de bouwer naar de vorm waarin discord.js een bericht teruggeeft. */
const alsBericht = (menu: RoleMenuSpec, lijst = opties): Message => {
  const gebouwd = bouwRolmenu(menu, lijst);
  const embed = (gebouwd.embeds?.[0] as { toJSON: () => { title?: string; description?: string; color?: number } }).toJSON();

  return {
    id: 'm1',
    channelId: 'c1',
    embeds: [{ title: embed.title ?? null, description: embed.description ?? null, color: embed.color ?? null }],
    components: (gebouwd.components ?? []).map((rij) => {
      const json = (rij as { toJSON: () => { components: Record<string, any>[] } }).toJSON();
      return {
        components: json.components.map((component) => ({
          customId: component['custom_id'],
          label: component['label'] ?? null,
          emoji: component['emoji'] ?? null,
          options: component['options']?.map((optie: Record<string, any>) => ({
            value: optie['value'],
            label: optie['label'],
            description: optie['description'] ?? null,
            emoji: optie['emoji'] ?? null,
          })),
        })),
      };
    }),
  } as unknown as Message;
};

describe('het bericht bouwen', () => {
  it('zet de rollen als knoppen neer, vijf per rij', () => {
    const veel = Array.from({ length: 7 }, (_, index) => ({ ...opties[0]!, roleId: String(index) }));
    const gebouwd = bouwRolmenu(menuUit(), veel);
    expect(gebouwd.components).toHaveLength(2);
  });

  it('maakt er een keuzemenu van als dat gevraagd wordt', () => {
    const gebouwd = bouwRolmenu(menuUit({ style: 'menu' }), opties);
    const rij = (gebouwd.components?.[0] as { toJSON: () => { components: Record<string, any>[] } }).toJSON();
    const kiezer = rij.components[0]!;

    expect(kiezer['custom_id']).toBe('rolmenu-kies');
    // Nul mogen kiezen is hoe je al je rollen weer uitzet.
    expect(kiezer['min_values']).toBe(0);
    expect(kiezer['max_values']).toBe(2);
  });
});

describe('zijn eigen bericht terugkennen', () => {
  it('leest de knoppen terug zoals ze erin gingen', () => {
    const gelezen = leesRolmenu(alsBericht(menuUit()), 'rollen');

    expect(gelezen?.title).toBe('Waar speel je op?');
    expect(gelezen?.style).toBe('buttons');
    expect(gelezen?.options.map((optie) => optie.roleId)).toEqual(['100', '200']);
  });

  it('leest een keuzemenu terug, met de beschrijvingen erbij', () => {
    const gelezen = leesRolmenu(alsBericht(menuUit({ style: 'menu' })), 'rollen');

    expect(gelezen?.style).toBe('menu');
    expect(gelezen?.options[1]?.description).toBe('PlayStation of Xbox');
  });

  it('laat een bericht dat niet van ons is met rust', () => {
    const vreemd = { id: 'x', channelId: 'c1', embeds: [], components: [] } as unknown as Message;
    expect(leesRolmenu(vreemd, 'rollen')).toBeNull();
  });
});

describe('staat het er al zo?', () => {
  const menu = menuUit();
  const ids: Record<string, string> = { pc: '100', console: '200' };
  const namen: Record<string, string> = { pc: 'PC', console: 'Console' };
  const kijk = (bericht: Message, rolId = (key: string) => ids[key] ?? null) =>
    rolmenuGelijk(leesRolmenu(bericht, 'rollen')!, menu, rolId, (key) => namen[key] ?? key);

  it('ja, als het bericht precies zo gebouwd is', () => {
    expect(kijk(alsBericht(menu))).toBe(true);
  });

  it('nee, als er een andere tekst op de knop staat', () => {
    const anders = alsBericht(menu, [{ ...opties[0]!, label: 'Desktop' }, opties[1]!]);
    expect(kijk(anders)).toBe(false);
  });

  it('nee, als de rollen in een andere volgorde staan', () => {
    expect(kijk(alsBericht(menu, [opties[1]!, opties[0]!]))).toBe(false);
  });

  it('nee, als er een rol bij gekomen is', () => {
    expect(kijk(alsBericht(menu, [...opties, { ...opties[0]!, roleId: '300' }]))).toBe(false);
  });

  it('nee, zolang een rol nog aangemaakt moet worden', () => {
    expect(kijk(alsBericht(menu), (key) => (key === 'pc' ? null : ids[key] ?? null))).toBe(false);
  });
});

describe('emoji vergelijken', () => {
  it('leest de naam uit een eigen emoji', () => {
    expect(emojiNaam('<:kroon:123456789>')).toBe('kroon');
  });

  it('laat een gewone emoji staan zoals hij is', () => {
    expect(emojiNaam('🖥️')).toBe('🖥️');
  });

  it('geen emoji blijft geen emoji', () => {
    expect(emojiNaam(undefined)).toBeNull();
  });
});

describe('wat er op de knop komt', () => {
  it('de naam van de rol, als de template niets zegt', () => {
    expect(optieLabel(undefined, 'PC')).toBe('PC');
  });

  it('en anders wat de template zegt', () => {
    expect(optieLabel('Desktop', 'PC')).toBe('Desktop');
  });
});

describe('klikken', () => {
  it('geeft wat aangevinkt is en haalt weg wat uitgevinkt is', () => {
    expect(watVerandert(['1', '2', '3'], ['1', '3'], ['2', '3', '9'])).toEqual({ erbij: ['1'], eraf: ['2'] });
  });

  it('blijft af van rollen die niet in dit menu staan', () => {
    expect(watVerandert(['1'], [], ['9'])).toEqual({ erbij: [], eraf: [] });
  });

  it('legt uit dat een rol boven de bot staat', () => {
    const nee = waaromNiet({ position: 9, managed: false, name: 'Admin' }, { hoogstePositie: 5, magRollenBeheren: true });
    expect(nee).toContain('boven mijn eigen rol');
  });

  it('legt uit dat de bot geen rollen mag beheren', () => {
    const nee = waaromNiet({ position: 1, managed: false, name: 'PC' }, { hoogstePositie: 5, magRollenBeheren: false });
    expect(nee).toContain('Rollen beheren');
  });

  it('laat een botrol met rust', () => {
    expect(waaromNiet({ position: 1, managed: true, name: 'Bot' }, { hoogstePositie: 5, magRollenBeheren: true }))
      .toContain('bot of een boost');
  });

  it('zegt niets als het gewoon kan', () => {
    expect(waaromNiet({ position: 1, managed: false, name: 'PC' }, { hoogstePositie: 5, magRollenBeheren: true })).toBeNull();
  });
});

describe('de controle op een rolmenu', () => {
  const controleer = (extra: Record<string, unknown>, rolExtra: Record<string, unknown> = {}) =>
    // Alleen wat over het rolmenu zelf gaat; de rest van de template mag hier
    // best iets van vinden.
    lintTemplate(
      parseTemplate({
        name: 'Test',
        roles: [{ key: 'pc', name: 'PC', ...rolExtra }],
        categories: [
          {
            name: 'Info',
            overwrites: [{ role: '@everyone', deny: ['ViewChannel'] }],
            channels: [{ name: 'verstopt' }],
          },
        ],
        uncategorizedChannels: [{ name: 'rollen' }],
        roleMenus: [{ channel: 'rollen', title: 'Kies', options: [{ role: 'pc' }], ...extra }],
      }),
    ).filter((punt) => punt.where.startsWith('rolmenu'));

  it('slaat alarm bij een rol die iedereen zomaar kan pakken', () => {
    const fouten = controleer({}, { permissions: ['ManageGuild'] }).filter((punt) => punt.severity === 'error');
    expect(fouten[0]?.message).toContain('ManageGuild');
  });

  it('waarschuwt als niemand het kanaal kan zien', () => {
    const punten = controleer({ channel: 'verstopt' }).filter((punt) => punt.severity === 'warning');
    expect(punten[0]?.message).toContain('verstopt voor @everyone');
  });

  it('zegt niets over een gewoon rolmenu', () => {
    expect(controleer({}).filter((punt) => punt.severity !== 'info')).toEqual([]);
  });
});

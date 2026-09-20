import { describe, expect, it } from 'vitest';
import { countReset, describeReset, describeScope, explainDeleteFailure, planReset } from '../src/reset.js';
import type { GuildSnapshot, SnapshotRole } from '../src/snapshot.js';

const role = (id: string, name: string, position: number, extra: Partial<SnapshotRole> = {}): SnapshotRole => ({
  id, name, color: 0, hoist: false, mentionable: false, permissions: 0n, position, rawPosition: position,
  managed: false, isEveryone: false, ...extra,
});

const snapshot: GuildSnapshot = {
  id: 'g1',
  name: 'Testserver',
  roles: [
    role('g1', '@everyone', 0, { isEveryone: true }),
    role('r1', 'Lid', 1),
    role('r2', 'Moderator', 2),
    role('r3', 'Een bot', 3, { managed: true }),
    role('r4', 'Eigenaar', 8),
  ],
  categories: [{ id: 'c1', name: 'Gesprekken', position: 0, overwrites: [] }],
  channels: [
    { id: 'ch1', name: 'algemeen', type: 'text', parentId: 'c1', topic: null, nsfw: false, slowmodeSeconds: 0, userLimit: null, position: 0, overwrites: [] },
  ],
  emojis: [],
  automod: [{ id: 'a1', name: 'Spam' }],
};

// De bot staat op 5: alles daaronder mag weg, alles daarboven niet.
const plan = planReset(snapshot, 5);

describe('leeghalen', () => {
  it('neemt kanalen en categorieen mee', () => {
    expect(plan.channels.map((c) => c.name)).toEqual(['algemeen', 'Gesprekken']);
  });

  it('verwijdert kanalen voor hun categorie', () => {
    expect(plan.channels.findIndex((c) => c.name === 'algemeen'))
      .toBeLessThan(plan.channels.findIndex((c) => c.name === 'Gesprekken'));
  });

  it('laat @everyone met rust', () => {
    expect(plan.roles.some((r) => r.name === '@everyone')).toBe(false);
  });

  it('laat rollen van bots en integraties met rust', () => {
    expect(plan.roles.some((r) => r.name === 'Een bot')).toBe(false);
    expect(plan.skipped.join(' ')).toContain('integratie');
  });

  it('laat rollen boven de bot met rust', () => {
    expect(plan.roles.some((r) => r.name === 'Eigenaar')).toBe(false);
    expect(plan.skipped.join(' ')).toContain('hoger dan de bot');
  });

  it('neemt de rollen eronder wel mee', () => {
    expect(plan.roles.map((r) => r.name).sort()).toEqual(['Lid', 'Moderator']);
  });

  it('neemt automod-regels mee', () => {
    expect(plan.automod).toEqual([{ id: 'a1', name: 'Spam' }]);
  });

  it('telt en beschrijft wat er gebeurt', () => {
    expect(countReset(plan)).toBe(5);
    expect(describeReset(plan)[0]).toBe('- kanaal algemeen');
    expect(describeReset(plan).some((line) => line.startsWith('  blijft staan'))).toBe(true);
  });

  it('doet niets op een lege server', () => {
    const leeg = planReset({ ...snapshot, roles: [], categories: [], channels: [], automod: [] }, 5);
    expect(countReset(leeg)).toBe(0);
  });
});

describe('uitleg bij een mislukte verwijdering', () => {
  const discordError = (code: number, message: string) => Object.assign(new Error(message), { code });

  it('legt uit dat de bot het kanaal niet kan zien', () => {
    const uitleg = explainDeleteFailure(discordError(50001, 'Missing Access'));
    expect(uitleg).toContain('niet zien');
  });

  it('wijst bij ontbrekende rechten naar de rolvolgorde', () => {
    expect(explainDeleteFailure(discordError(50013, 'Missing Permissions'))).toContain('rol hoog genoeg');
  });

  it('laat onbekende fouten staan zoals ze zijn', () => {
    expect(explainDeleteFailure(new Error('iets anders'))).toBe('iets anders');
  });
});

describe('kiezen wat er weg mag', () => {
  it('laat de rollen staan als je dat kiest', () => {
    const keuze = planReset(snapshot, 5, { channels: true, roles: false, automod: true });
    expect(keuze.roles).toEqual([]);
    expect(keuze.channels.length).toBeGreaterThan(0);
    expect(keuze.automod.length).toBeGreaterThan(0);
  });

  it('zegt in het plan dat de rollen met opzet blijven', () => {
    const keuze = planReset(snapshot, 5, { channels: true, roles: false, automod: true });
    expect(describeReset(keuze).join('\n')).toContain('rollen blijven staan');
  });

  it('laat de kanalen staan als je alleen rollen weggooit', () => {
    const keuze = planReset(snapshot, 5, { channels: false, roles: true, automod: false });
    expect(keuze.channels).toEqual([]);
    expect(keuze.automod).toEqual([]);
    expect(keuze.roles.map((r) => r.name)).toEqual(['Lid', 'Moderator']);
  });

  it('telt niets als er niets gekozen is', () => {
    expect(countReset(planReset(snapshot, 5, { channels: false, roles: false, automod: false }))).toBe(0);
  });

  it('gooit zonder keuze nog steeds alles weg', () => {
    expect(countReset(planReset(snapshot, 5))).toBe(countReset(plan));
  });

  it('houdt zich ook met een keuze aan de rollen die niemand mag aanraken', () => {
    const keuze = planReset(snapshot, 5, { channels: false, roles: true, automod: false });
    expect(keuze.roles.map((r) => r.name)).not.toContain('Een bot');
    expect(keuze.roles.map((r) => r.name)).not.toContain('Eigenaar');
  });
});

describe('uitleg over de keuze', () => {
  it('noemt wat weg gaat en wat blijft', () => {
    expect(describeScope({ channels: true, roles: false, automod: true })).toBe(
      'Weg: kanalen, automod-regels. Blijft staan: rollen.',
    );
  });

  it('zegt het als alles weg gaat', () => {
    expect(describeScope({ channels: true, roles: true, automod: true })).toBe(
      'Weg: kanalen, rollen, automod-regels.',
    );
  });

  it('zegt het als er niets gekozen is', () => {
    expect(describeScope({ channels: false, roles: false, automod: false })).toMatch(/niets/);
  });
});

describe('rollen uitsluiten van verwijdering', () => {
  const metUitzondering = (...namen: string[]) =>
    planReset(snapshot, 5, { channels: true, roles: true, automod: true, behoudRollen: namen });

  it('laat een rol met die naam staan', () => {
    const keuze = metUitzondering('Moderator');
    expect(keuze.roles.map((rol) => rol.name)).toEqual(['Lid']);
  });

  it('trekt zich niets aan van hoofdletters of spaties', () => {
    expect(metUitzondering('  moderator ').roles.map((rol) => rol.name)).toEqual(['Lid']);
  });

  it('kan er meerdere aan', () => {
    expect(metUitzondering('Lid', 'Moderator').roles).toEqual([]);
  });

  it('zegt in het plan waarom die rol blijft', () => {
    expect(describeReset(metUitzondering('Moderator')).join('\n')).toContain(
      'rol "Moderator" staat op de lijst met rollen die moeten blijven',
    );
  });

  it('waarschuwt bij een naam die niet bestaat, zodat een typfout opvalt', () => {
    expect(describeReset(metUitzondering('Moderatr')).join('\n')).toContain(
      'er is geen rol die "Moderatr" heet',
    );
  });

  it('raakt de kanalen niet', () => {
    expect(metUitzondering('Moderator').channels.length).toBeGreaterThan(0);
  });

  it('noemt de uitzonderingen in de uitleg', () => {
    expect(
      describeScope({ channels: true, roles: true, automod: true, behoudRollen: ['Admin'] }),
    ).toContain('Deze rollen blijven hoe dan ook: @Admin');
  });

  it('verandert niets zonder uitzonderingen', () => {
    expect(metUitzondering().roles.map((rol) => rol.name)).toEqual(['Lid', 'Moderator']);
  });
});

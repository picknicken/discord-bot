import { describe, expect, it } from 'vitest';
import { parseTemplate } from '../src/types.js';
import { toBitfield, toNames, unknownPermissions } from '../src/permissions.js';
import { loadAllTemplates } from '../src/templates.js';

describe('templateschema', () => {
  it('vult standaardwaarden aan', () => {
    const template = parseTemplate({ name: 'Minimaal' });
    expect(template.roles).toEqual([]);
    expect(template.categories).toEqual([]);
    expect(template.description).toBe('');
  });

  it('weigert onbekende permissies', () => {
    expect(() =>
      parseTemplate({ name: 'X', roles: [{ key: 'a', name: 'A', permissions: ['SendMissiles'] }] }),
    ).toThrow(/Onbekende permissie/);
  });

  it('weigert overwrites naar niet-bestaande rollen', () => {
    expect(() =>
      parseTemplate({
        name: 'X',
        categories: [{ name: 'Cat', channels: [{ name: 'chan', overwrites: [{ role: 'spook' }] }] }],
      }),
    ).toThrow(/onbekende rol/);
  });

  it('accepteert @everyone zonder roldefinitie', () => {
    const template = parseTemplate({
      name: 'X',
      categories: [{ name: 'Cat', overwrites: [{ role: '@everyone', deny: ['ViewChannel'] }] }],
    });
    expect(template.categories[0]?.overwrites[0]?.role).toBe('@everyone');
  });

  it('weigert dubbele rol-keys', () => {
    expect(() =>
      parseTemplate({ name: 'X', roles: [{ key: 'a', name: 'A' }, { key: 'a', name: 'B' }] }),
    ).toThrow(/dubbele rol-key/);
  });

  it('weigert een ongeldige kleur', () => {
    expect(() => parseTemplate({ name: 'X', roles: [{ key: 'a', name: 'A', color: 'rood' }] })).toThrow(/hexwaarde/);
  });
});

describe('templateschema: nieuwe onderdelen', () => {
  const base = { name: 'X', roles: [{ key: 'mod', name: 'Mod' }] };
  const withChannel = (channel: Record<string, unknown>) => ({
    ...base,
    categories: [{ name: 'Cat', channels: [{ name: 'chan', ...channel }] }],
  });

  it('weigert automod met action alert zonder kanaal', () => {
    expect(() =>
      parseTemplate({ ...base, automod: [{ name: 'R', trigger: 'spam', action: 'alert' }] }),
    ).toThrow(/alertChannel/);
  });

  it('weigert automod die naar een onbekend kanaal meldt', () => {
    expect(() =>
      parseTemplate({
        ...base,
        automod: [{ name: 'R', trigger: 'spam', action: 'alert', alertChannel: 'nergens' }],
      }),
    ).toThrow(/onbekend kanaal/);
  });

  it('weigert een keyword-regel zonder woorden', () => {
    expect(() => parseTemplate({ ...base, automod: [{ name: 'R', trigger: 'keyword' }] })).toThrow(/keywords/);
  });

  it('weigert forum-tags op een tekstkanaal', () => {
    expect(() => parseTemplate(withChannel({ type: 'text', tags: [{ name: 'Vraag' }] }))).toThrow(/forumkanaal/);
  });

  it('weigert berichten in een voicekanaal', () => {
    expect(() => parseTemplate(withChannel({ type: 'voice', messages: [{ content: 'hoi' }] }))).toThrow(
      /text- of announcement/,
    );
  });

  it('weigert community zonder regels- en updateskanaal', () => {
    expect(() => parseTemplate({ ...base, guild: { community: true } })).toThrow(/rulesChannel/);
  });

  it('weigert een emoji voor een onbekende rol', () => {
    expect(() =>
      parseTemplate({ ...base, emojis: [{ name: 'blij', image: './a.png', roles: ['spook'] }] }),
    ).toThrow(/onbekende rol/);
  });

  it('accepteert een volledige template met alle nieuwe velden', () => {
    const template = parseTemplate({
      ...base,
      guild: { community: true, rulesChannel: 'chan', updatesChannel: 'chan', icon: './icon.png' },
      categories: [
        {
          name: 'Cat',
          channels: [
            { name: 'chan', type: 'text', messages: [{ content: 'regels' }] },
            { name: 'forum', type: 'forum', tags: [{ name: 'Vraag', moderated: true }], defaultReaction: '👍' },
          ],
        },
      ],
      automod: [{ name: 'R', trigger: 'keyword', keywords: ['spam'], exemptRoles: ['mod'] }],
      onboarding: { defaultChannels: ['chan'], prompts: [{ title: 'Hoi?', options: [{ title: 'Ja', roles: ['mod'] }] }] },
    });

    expect(template.categories[0]?.channels[0]?.messages[0]?.pin).toBe(true);
    expect(template.automod[0]?.action).toBe('block');
    expect(template.onboarding?.mode).toBe('default');
  });
});

describe('permissies', () => {
  it('vertaalt heen en weer', () => {
    const names = ['ViewChannel', 'SendMessages'];
    expect(toNames(toBitfield(names)).sort()).toEqual([...names].sort());
  });

  it('herkent onbekende namen', () => {
    expect(unknownPermissions(['ViewChannel', 'Nonsense'])).toEqual(['Nonsense']);
  });
});

describe('meegeleverde templates', () => {
  it('zijn allemaal geldig', async () => {
    const templates = await loadAllTemplates('./templates');
    expect(templates.length).toBeGreaterThan(0);
    for (const { id, template } of templates) {
      expect(template.name, `${id} heeft een naam`).toBeTruthy();
      expect(template.roles.length, `${id} heeft rollen`).toBeGreaterThan(0);
    }
  });
});

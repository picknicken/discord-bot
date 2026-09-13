import { GuildExplicitContentFilter, GuildVerificationLevel } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { communityEdit, communitySafeSettings, rolePositions } from '../src/applier.js';
import { lintTemplate } from '../src/lint.js';
import { parseTemplate } from '../src/types.js';
import { loadAllTemplates } from '../src/templates.js';

const fouten = (template: ReturnType<typeof parseTemplate>, tekst: string) =>
  lintTemplate(template).filter((finding) => finding.message.includes(tekst));

describe('community-modus aanzetten', () => {
  it('stuurt kenmerk en kanalen in één opdracht', () => {
    // Twee losse opdrachten weigert Discord allebei: een regelskanaal mag niet
    // op een gewone server, en COMMUNITY niet zonder regelskanaal.
    const edit = communityEdit([], GuildVerificationLevel.Medium, 'r1', 'u1');
    expect(edit.features).toContain('COMMUNITY');
    expect(edit.rulesChannel).toBe('r1');
    expect(edit.publicUpdatesChannel).toBe('u1');
  });

  it('houdt bestaande kenmerken en zet COMMUNITY er niet dubbel in', () => {
    const edit = communityEdit(['NEWS', 'COMMUNITY'], GuildVerificationLevel.Low, 'r1', 'u1');
    expect(edit.features).toEqual(['NEWS', 'COMMUNITY']);
  });

  it('tilt verificatie op naar laag en zet het filter op alle leden', () => {
    const edit = communityEdit([], GuildVerificationLevel.None, 'r1', 'u1');
    expect(edit.verificationLevel).toBe(GuildVerificationLevel.Low);
    expect(edit.explicitContentFilter).toBe(GuildExplicitContentFilter.AllMembers);
  });

  it('laat een hoger verificatieniveau staan', () => {
    const edit = communityEdit([], GuildVerificationLevel.High, 'r1', 'u1');
    expect(edit.verificationLevel).toBe(GuildVerificationLevel.High);
  });
});

describe('controle op het regels- en updateskanaal', () => {
  const basis = {
    name: 'X',
    guild: { community: true, rulesChannel: '✅│regels', updatesChannel: '📣│aankondigingen' },
    categories: [
      {
        name: 'Info',
        channels: [
          { name: '✅│regels', type: 'text' },
          { name: '📣│aankondigingen', type: 'announcement' },
        ],
      },
    ],
  };

  it('wijst een updateskanaal af dat zelf pas na community kan bestaan', () => {
    const gevonden = fouten(parseTemplate(basis), 'updatesChannel wijst naar');
    expect(gevonden[0]?.severity).toBe('error');
  });

  it('wijst een regelskanaal af dat geen tekstkanaal is', () => {
    const template = parseTemplate({
      ...basis,
      guild: { community: true, rulesChannel: '🔊│Lobby', updatesChannel: '📢│updates' },
      categories: [
        {
          name: 'Info',
          channels: [
            { name: '🔊│Lobby', type: 'voice' },
            { name: '📢│updates', type: 'text' },
          ],
        },
      ],
    });
    expect(fouten(template, 'alleen een tekstkanaal')[0]?.severity).toBe('error');
  });

  it('waarschuwt als niemand de regels kan lezen', () => {
    const template = parseTemplate({
      name: 'X',
      guild: { community: true, rulesChannel: '✅│regels', updatesChannel: '📢│updates' },
      categories: [
        {
          name: 'Info',
          overwrites: [{ role: '@everyone', deny: ['ViewChannel'] }],
          channels: [
            { name: '✅│regels', type: 'text' },
            { name: '📢│updates', type: 'text' },
          ],
        },
      ],
    });
    expect(fouten(template, 'regelskanaal')[0]?.severity).toBe('warning');
  });

  it('laat een goed stel kanalen met rust', () => {
    const template = parseTemplate({
      name: 'X',
      guild: { community: true, rulesChannel: '✅│regels', updatesChannel: '📢│updates' },
      categories: [
        { name: 'Info', channels: [{ name: '✅│regels', type: 'text' }, { name: '📢│updates', type: 'text' }] },
      ],
    });
    expect(fouten(template, 'rulesChannel')).toHaveLength(0);
    expect(fouten(template, 'updatesChannel')).toHaveLength(0);
  });
});

describe('controle op onboarding', () => {
  const kanalen = (aantal: number, mogenPraten: number) =>
    Array.from({ length: aantal }, (_, index) => ({
      name: `kanaal-${index}`,
      type: 'text',
      overwrites: index < mogenPraten ? [] : [{ role: '@everyone', deny: ['SendMessages'] }],
    }));

  const maak = (mogenPraten: number, verstopt = false) =>
    parseTemplate({
      name: 'X',
      guild: { community: true, rulesChannel: 'kanaal-0', updatesChannel: 'kanaal-1' },
      categories: [
        {
          name: 'Alles',
          ...(verstopt ? { overwrites: [{ role: '@everyone', deny: ['ViewChannel'] }] } : {}),
          channels: kanalen(8, mogenPraten),
        },
      ],
      onboarding: {
        enabled: true,
        defaultChannels: Array.from({ length: 8 }, (_, index) => `kanaal-${index}`),
      },
    });

  it('meldt standaardkanalen die niemand ziet', () => {
    expect(fouten(maak(8, true), 'verstopt voor @everyone')[0]?.severity).toBe('error');
  });

  it('waarschuwt bij te weinig kanalen om in te praten', () => {
    const gevonden = fouten(maak(3), 'minstens 5');
    expect(gevonden[0]?.severity).toBe('warning');
  });

  it('zwijgt als er genoeg kanalen zijn om in te praten', () => {
    expect(fouten(maak(5), 'minstens 5')).toHaveLength(0);
  });
});

describe('instellingen op een community-server', () => {
  it('zet het filter op alle leden, wat de template ook zegt', () => {
    const { explicitContentFilter } = communitySafeSettings(
      GuildVerificationLevel.High,
      GuildExplicitContentFilter.MembersWithoutRoles,
      true,
    );
    expect(explicitContentFilter).toBe(GuildExplicitContentFilter.AllMembers);
  });

  it('tilt verificatie "geen" op naar laag', () => {
    expect(communitySafeSettings(GuildVerificationLevel.None, undefined, true).verificationLevel).toBe(
      GuildVerificationLevel.Low,
    );
  });

  it('laat een gewone server met rust', () => {
    const uit = communitySafeSettings(
      GuildVerificationLevel.None,
      GuildExplicitContentFilter.Disabled,
      false,
    );
    expect(uit.verificationLevel).toBe(GuildVerificationLevel.None);
    expect(uit.explicitContentFilter).toBe(GuildExplicitContentFilter.Disabled);
  });
});

describe('rolvolgorde', () => {
  it('houdt alle rollen onder de bot', () => {
    const { positions, warning } = rolePositions(['a', 'b', 'c'], 5);
    expect(positions).toEqual([
      { role: 'a', position: 4 },
      { role: 'b', position: 3 },
      { role: 'c', position: 2 },
    ]);
    expect(warning).toBeNull();
  });

  it('doet er zoveel als er passen en zegt dat', () => {
    const { positions, warning } = rolePositions(['a', 'b', 'c'], 3);
    expect(positions).toEqual([
      { role: 'a', position: 2 },
      { role: 'b', position: 1 },
    ]);
    expect(warning).toMatch(/2 van 3/);
  });

  it('slaat het over als de bot helemaal onderaan staat', () => {
    const { positions, warning } = rolePositions(['a'], 1);
    expect(positions).toEqual([]);
    expect(warning).toMatch(/Sleep de rol van de bot/);
  });

  it('komt nooit op de plek van @everyone', () => {
    const { positions } = rolePositions(['a', 'b', 'c', 'd'], 9);
    expect(positions.every((entry) => entry.position >= 1)).toBe(true);
  });
});

describe('de meegeleverde templates', () => {
  it('komen alle drie schoon door de controle', async () => {
    const templates = await loadAllTemplates('./templates');
    for (const { id, template } of templates) {
      const errors = lintTemplate(template).filter((finding) => finding.severity === 'error');
      expect(errors, `${id}: ${errors.map((e) => e.message).join(' | ')}`).toHaveLength(0);
    }
  });
});

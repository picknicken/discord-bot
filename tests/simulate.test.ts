import { describe, expect, it } from 'vitest';
import { channelsNobodySees, simulate, simulatableRoles } from '../src/simulate.js';
import { lintTemplate, countBySeverity } from '../src/lint.js';
import { loadTemplate } from '../src/templates.js';
import { parseTemplate } from '../src/types.js';

const community = await loadTemplate('./templates', 'community');

const visible = (template: Parameters<typeof simulate>[0], role: string) =>
  simulate(template, role)
    .categories.flatMap((category) => category.channels)
    .filter((channel) => channel.visible)
    .map((channel) => channel.name);

describe('simulatie van zichtbaarheid', () => {
  it('laat @everyone alleen de welkomstzone zien', () => {
    const names = visible(community, '@everyone');
    expect(names).toContain('👋│welkom');
    expect(names).not.toContain('🗣️│algemeen');
    expect(names).not.toContain('🛡️│staf-chat');
  });

  it('geeft een lid toegang tot de gesprekken maar niet tot de staf', () => {
    const names = visible(community, 'lid');
    expect(names).toContain('🗣️│algemeen');
    expect(names).toContain('❓│vragen');
    expect(names).not.toContain('🛡️│staf-chat');
  });

  it('laat een rol met Administrator alles zien', () => {
    const admin = simulate(community, 'admin');
    expect(admin.administrator).toBe(true);
    expect(admin.visibleCount).toBe(admin.totalCount);
  });

  it('legt per kanaal uit waarom het wel of niet zichtbaar is', () => {
    const staf = simulate(community, 'moderator')
      .categories.find((category) => category.name === '🛡️ Staf')
      ?.channels[0];
    expect(staf?.visible).toBe(true);
    expect(staf?.reason).toMatch(/deze rol krijgt toegang/);
  });

  it('kent alle rollen plus @everyone', () => {
    expect(simulatableRoles(community).map((role) => role.key)).toEqual([
      '@everyone', 'admin', 'moderator', 'lid', 'bots',
    ]);
  });

  it('een kanaal met eigen overwrites erft niet van de categorie', () => {
    const template = parseTemplate({
      name: 'X',
      roles: [{ key: 'lid', name: 'Lid' }],
      categories: [{
        name: 'Besloten',
        overwrites: [{ role: '@everyone', deny: ['ViewChannel'] }],
        channels: [
          { name: 'geheim' },
          { name: 'open', overwrites: [{ role: '@everyone', allow: ['ViewChannel'] }] },
        ],
      }],
    });

    expect(visible(template, '@everyone')).toEqual(['open']);
  });

  it('vindt kanalen die niemand kan zien', () => {
    const template = parseTemplate({
      name: 'X',
      roles: [{ key: 'lid', name: 'Lid' }],
      categories: [{
        name: 'Zwart gat',
        overwrites: [{ role: '@everyone', deny: ['ViewChannel'] }],
        channels: [{ name: 'onvindbaar' }],
      }],
    });

    expect(channelsNobodySees(template)).toEqual(['onvindbaar']);
    expect(channelsNobodySees(community)).toEqual([]);
  });
});

describe('namen met emoji', () => {
  it('houdt emoji en scheidingsteken in de kanaalnaam', () => {
    const namen = community.categories.flatMap((category) => category.channels.map((c) => c.name));
    expect(namen).toContain('✅│regels');
    expect(namen.every((naam) => naam.includes('│'))).toBe(true);
  });

  it('zet geen scheidingsteken in categorienamen', () => {
    for (const category of community.categories) {
      expect(category.name, category.name).not.toContain('│');
      expect(category.name).toMatch(/^\p{Extended_Pictographic}/u);
    }
  });

  it('waarschuwt niet over emoji in een tekstkanaal', () => {
    const overNamen = lintTemplate(community).filter((f) => f.message.includes('kleine letters'));
    expect(overNamen).toEqual([]);
  });
});

describe('controles vooraf', () => {
  it('vindt niets ergs in de meegeleverde templates', () => {
    const findings = lintTemplate(community);
    expect(countBySeverity(findings).error).toBe(0);
  });

  it('waarschuwt bij dubbele kanaalnamen in een categorie', () => {
    const template = parseTemplate({
      name: 'X',
      categories: [{ name: 'Cat', channels: [{ name: 'chat' }, { name: 'Chat' }] }],
    });
    expect(lintTemplate(template).some((finding) => finding.message.includes('twee kanalen'))).toBe(true);
  });

  it('waarschuwt als @everyone gevaarlijke rechten krijgt', () => {
    const template = parseTemplate({
      name: 'X',
      categories: [{
        name: 'Cat',
        overwrites: [{ role: '@everyone', allow: ['ManageChannels', 'ViewChannel'] }],
        channels: [{ name: 'chat' }],
      }],
    });
    expect(lintTemplate(template).some((finding) => finding.message.includes('ManageChannels'))).toBe(true);
  });

  it('meldt te veel automod-regels van hetzelfde type', () => {
    const template = parseTemplate({
      name: 'X',
      automod: [
        { name: 'A', trigger: 'spam' },
        { name: 'B', trigger: 'spam' },
      ],
    });
    const findings = lintTemplate(template);
    expect(findings.some((finding) => finding.severity === 'error' && finding.where === 'automod')).toBe(true);
  });

  it('waarschuwt als een kanaal de beperkingen van zijn categorie verliest', () => {
    const template = parseTemplate({
      name: 'X',
      roles: [{ key: 'mod', name: 'Mod' }],
      categories: [{
        name: 'Welkom',
        overwrites: [{ role: '@everyone', allow: ['ViewChannel'], deny: ['SendMessages'] }],
        channels: [{ name: 'nieuws', overwrites: [{ role: 'mod', allow: ['SendMessages'] }] }],
      }],
    });

    const finding = lintTemplate(template).find((item) => item.message.includes('verliest'));
    expect(finding?.severity).toBe('warning');
    expect(finding?.message).toContain('SendMessages');
  });

  it('waarschuwt niet als het kanaal de beperking zelf herhaalt', () => {
    const template = parseTemplate({
      name: 'X',
      roles: [{ key: 'mod', name: 'Mod' }],
      categories: [{
        name: 'Welkom',
        overwrites: [{ role: '@everyone', allow: ['ViewChannel'], deny: ['SendMessages'] }],
        channels: [{
          name: 'nieuws',
          overwrites: [
            { role: '@everyone', allow: ['ViewChannel'], deny: ['SendMessages'] },
            { role: 'mod', allow: ['SendMessages'] },
          ],
        }],
      }],
    });

    expect(lintTemplate(template).some((item) => item.message.includes('verliest'))).toBe(false);
  });

  it('geeft de meegeleverde templates geen waarschuwingen meer', async () => {
    for (const id of ['community', 'gaming', 'bedrijf']) {
      const template = await loadTemplate('./templates', id);
      const serious = lintTemplate(template).filter((finding) => finding.severity !== 'info');
      expect(serious, `${id}: ${serious.map((f) => f.message).join(' | ')}`).toEqual([]);
    }
  });

  it('meldt hoofdletters in een tekstkanaal', () => {
    const template = parseTemplate({ name: 'X', uncategorizedChannels: [{ name: 'Mijn Kanaal' }] });
    expect(lintTemplate(template).some((finding) => finding.message.includes('kleine letters'))).toBe(true);
  });
});

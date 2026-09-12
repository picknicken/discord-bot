import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { explainShortfalls, missingForTemplate, permissionShortfalls } from '../src/preflight.js';
import { BEPERKTE_PERMISSIONS } from '../src/botPermissions.js';
import { loadTemplate } from '../src/templates.js';
import { parseTemplate } from '../src/types.js';

const bot = (...permissions: bigint[]) => new PermissionsBitField(permissions);
const admin = bot(PermissionFlagsBits.Administrator);

describe('rechten die de bot mist', () => {
  it('ziet een rol met een recht dat de bot zelf niet heeft', () => {
    const template = parseTemplate({
      name: 'X',
      roles: [{ key: 'mod', name: 'Mod', permissions: ['KickMembers'] }],
    });
    const tekort = permissionShortfalls(template, bot(PermissionFlagsBits.ManageRoles));
    expect(tekort).toEqual([{ where: 'rol @Mod', permissions: ['KickMembers'] }]);
  });

  it('zwijgt als de bot het recht wel heeft', () => {
    const template = parseTemplate({
      name: 'X',
      roles: [{ key: 'mod', name: 'Mod', permissions: ['KickMembers'] }],
    });
    expect(permissionShortfalls(template, bot(PermissionFlagsBits.KickMembers))).toEqual([]);
  });

  it('houdt Administrator voor genoeg, wat er ook gevraagd wordt', () => {
    const template = parseTemplate({
      name: 'X',
      guild: { community: true, rulesChannel: 'regels', updatesChannel: 'updates' },
      roles: [{ key: 'baas', name: 'Baas', permissions: ['Administrator', 'BanMembers'] }],
      categories: [{ name: 'Info', channels: [{ name: 'regels' }, { name: 'updates' }] }],
    });
    expect(permissionShortfalls(template, admin)).toEqual([]);
  });

  it('vraagt Administrator voor community-modus', () => {
    const template = parseTemplate({
      name: 'X',
      guild: { community: true, rulesChannel: 'regels', updatesChannel: 'updates' },
      categories: [{ name: 'Info', channels: [{ name: 'regels' }, { name: 'updates' }] }],
    });
    const tekort = permissionShortfalls(template, BEPERKTE_PERMISSIONS);
    expect(tekort).toEqual([{ where: 'community-modus aanzetten', permissions: ['Administrator'] }]);
  });

  it('kijkt ook naar de rechten in een kanaal, allow én deny', () => {
    const template = parseTemplate({
      name: 'X',
      roles: [{ key: 'mod', name: 'Mod' }],
      categories: [
        {
          name: 'Cat',
          overwrites: [{ role: 'mod', allow: ['MentionEveryone'], deny: ['ManageMessages'] }],
          channels: [{ name: 'chan', overwrites: [{ role: 'mod', allow: ['MuteMembers'] }] }],
        },
      ],
    });
    const tekort = permissionShortfalls(template, bot(PermissionFlagsBits.ManageChannels));
    expect(tekort.map((t) => t.where)).toEqual(['categorie Cat', 'kanaal chan']);
    expect(tekort[0]?.permissions.sort()).toEqual(['ManageMessages', 'MentionEveryone']);
    expect(tekort[1]?.permissions).toEqual(['MuteMembers']);
  });

  it('vat alles samen tot één lijst zonder dubbelen', () => {
    const tekort = [
      { where: 'rol @A', permissions: ['KickMembers', 'BanMembers'] },
      { where: 'rol @B', permissions: ['KickMembers'] },
    ];
    expect(missingForTemplate(tekort)).toEqual(['BanMembers', 'KickMembers']);
  });
});

describe('uitleg bij wat er mist', () => {
  it('zegt niets als er niets mist', () => {
    expect(explainShortfalls([], 'https://discord.com/x')).toEqual([]);
  });

  it('noemt de plek, de rechten en de invite-link', () => {
    const tekst = explainShortfalls(
      [{ where: 'rol @Mod', permissions: ['KickMembers'] }],
      'https://discord.com/x',
    ).join('\n');
    expect(tekst).toContain('rol @Mod: KickMembers');
    expect(tekst).toContain('Administrator');
    expect(tekst).toContain('https://discord.com/x');
  });
});

describe('de meegeleverde templates tegen een bot zonder Administrator', () => {
  it('laten precies zien waar het misgaat', async () => {
    const gaming = await loadTemplate('./templates', 'gaming');
    const tekort = permissionShortfalls(gaming, BEPERKTE_PERMISSIONS);

    // Dit is de fout uit de mislukte run: community-modus en drie rollen.
    expect(tekort.map((t) => t.where)).toContain('community-modus aanzetten');
    expect(tekort.map((t) => t.where)).toContain('rol @Clan Owner');
    expect(missingForTemplate(tekort)).toContain('Administrator');
  });

  it('gaan schoon door de controle met Administrator', async () => {
    for (const id of ['bedrijf', 'community', 'gaming']) {
      const template = await loadTemplate('./templates', id);
      expect(permissionShortfalls(template, admin), id).toEqual([]);
    }
  });
});

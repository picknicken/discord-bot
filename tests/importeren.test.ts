import { describe, expect, it } from 'vitest';
import { templateCode, uitDiscordTemplate } from '../src/importeren.js';

/**
 * In een Discord-template staan rollen en kanalen niet met echte id's maar met
 * volgnummers, en rechten verwijzen naar het volgnummer van een rol. Daar
 * moeten namen van gemaakt worden, anders wijst elk recht naar niets.
 */
const bron = {
  name: 'Gezellige server',
  verification_level: 2,
  default_message_notifications: 1,
  explicit_content_filter: 2,
  system_channel_id: 11,
  roles: [
    { id: 0, name: '@everyone', permissions: '0' },
    { id: 1, name: 'Moderator', color: 0xed4245, hoist: true, permissions: '8192' },
  ],
  channels: [
    { id: 10, type: 4, name: 'Welkom', permission_overwrites: [{ id: 0, allow: '0', deny: '2048' }] },
    { id: 11, type: 0, name: 'welkom', parent_id: 10, topic: 'Hallo' },
    { id: 12, type: 2, name: 'Lounge', parent_id: 10, user_limit: 5 },
    { id: 13, type: 0, name: 'los-kanaal', parent_id: null },
  ],
} as never;

describe('een discord.new-link herkennen', () => {
  it('haalt de code uit alle vormen die Discord gebruikt', () => {
    expect(templateCode('https://discord.new/AbC123')).toBe('AbC123');
    expect(templateCode('https://discord.com/template/AbC123')).toBe('AbC123');
    expect(templateCode('  AbC123  ')).toBe('AbC123');
  });

  it('zegt nee tegen iets wat geen link is', () => {
    expect(templateCode('https://voorbeeld.nl/iets anders')).toBeNull();
    expect(templateCode('')).toBeNull();
  });
});

describe('een Discord-template overnemen', () => {
  const template = uitDiscordTemplate(bron, 'Mijn kopie');

  it('maakt van elke rol een sleutel, zonder @everyone in de lijst', () => {
    expect(template.roles.map((rol) => rol.key)).toEqual(['moderator']);
    expect(template.roles[0]).toMatchObject({ name: 'Moderator', color: '#ed4245', hoist: true });
    expect(template.roles[0]?.permissions).toContain('ManageMessages');
  });

  it('zet rechten om naar de rolsleutel, ook die van @everyone', () => {
    expect(template.categories[0]?.overwrites).toEqual([
      { role: '@everyone', allow: [], deny: ['SendMessages'] },
    ]);
  });

  it('hangt kanalen onder hun categorie, en de rest eronder', () => {
    expect(template.categories[0]?.name).toBe('Welkom');
    expect(template.categories[0]?.channels.map((kanaal) => kanaal.name)).toEqual(['welkom', 'Lounge']);
    expect(template.uncategorizedChannels.map((kanaal) => kanaal.name)).toEqual(['los-kanaal']);
  });

  it('neemt het kanaaltype en de serverinstellingen mee', () => {
    expect(template.categories[0]?.channels[1]).toMatchObject({ type: 'voice', userLimit: 5 });
    expect(template.guild).toMatchObject({
      verificationLevel: 'medium',
      defaultMessageNotifications: 'only_mentions',
      explicitContentFilter: 'all_members',
      // Het systeemkanaal stond er als volgnummer in; hier staat de naam.
      systemChannel: 'welkom',
    });
  });
});

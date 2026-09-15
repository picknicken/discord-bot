import { describe, expect, it } from 'vitest';
import { afstand, bedoeldeJe, dichtstbij } from '../src/bedoeldeJe.js';
import { PERMISSION_NAMES } from '../src/permissions.js';
import { parseTemplate } from '../src/types.js';

describe('afstand tussen twee woorden', () => {
  it('is nul bij hetzelfde woord', () => {
    expect(afstand('kanaal', 'kanaal')).toBe(0);
  });

  it('telt elke wijziging', () => {
    expect(afstand('kat', 'kart')).toBe(1);
    expect(afstand('kat', 'hond')).toBe(4);
  });

  it('kan met een leeg woord om', () => {
    expect(afstand('', 'rol')).toBe(3);
  });
});

describe('de dichtstbijzijnde naam', () => {
  it('vindt een typefout', () => {
    expect(dichtstbij('BanMember', PERMISSION_NAMES)).toBe('BanMembers');
  });

  it('trekt zich niets aan van hoofdletters en streepjes', () => {
    expect(dichtstbij('send_messages', PERMISSION_NAMES)).toBe('SendMessages');
  });

  it('kent de namen die Discord in de app anders schrijft', () => {
    // In Serverinstellingen heet dit "Manage Server", in de API ManageGuild.
    expect(dichtstbij('MANAGE_SERVER', PERMISSION_NAMES)).toBe('ManageGuild');
    expect(dichtstbij('Manage Emojis', PERMISSION_NAMES)).toBe('ManageGuildExpressions');
  });

  it('pakt een naam die ergens mee begint', () => {
    expect(dichtstbij('moderator', ['mod', 'lid'])).toBe('mod');
    expect(dichtstbij('welkom-hier', ['👋│welkom', 'regels'])).toBe(null);
    expect(dichtstbij('welkom-hier', ['welkom', 'regels'])).toBe('welkom');
  });

  it('zwijgt als er niets op lijkt', () => {
    expect(dichtstbij('ZomaarIets', PERMISSION_NAMES)).toBeNull();
    expect(dichtstbij('', PERMISSION_NAMES)).toBeNull();
  });

  it('maakt er een zin van, of niets', () => {
    expect(bedoeldeJe('BanMember', PERMISSION_NAMES)).toBe(' — bedoelde je "BanMembers"?');
    expect(bedoeldeJe('ZomaarIets', PERMISSION_NAMES)).toBe('');
  });
});

describe('in de foutmelding van een template', () => {
  const fout = (template: unknown): string => {
    try {
      parseTemplate(template);
      return '(geen fout)';
    } catch (error) {
      return (error as Error).message;
    }
  };

  it('helpt bij een permissie die net anders heet', () => {
    expect(fout({ name: 'X', roles: [{ key: 'a', name: 'A', permissions: ['MANAGE_SERVER'] }] })).toContain(
      'bedoelde je "ManageGuild"?',
    );
  });

  it('helpt bij een rol die net anders heet', () => {
    const melding = fout({
      name: 'X',
      roles: [{ key: 'mod', name: 'Mod' }],
      categories: [{ name: 'C', channels: [{ name: 'chan', overwrites: [{ role: 'moderator' }] }] }],
    });
    expect(melding).toContain('bedoelde je "mod"?');
  });

  it('helpt bij een kanaal dat net anders heet', () => {
    const melding = fout({
      name: 'X',
      guild: { systemChannel: 'welkom-hier' },
      categories: [{ name: 'C', channels: [{ name: 'welkom' }] }],
    });
    expect(melding).toContain('bedoelde je "welkom"?');
  });
});

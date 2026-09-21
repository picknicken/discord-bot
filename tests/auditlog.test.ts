import { AuditLogEvent } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { leesEntry } from '../src/auditlog.js';

/**
 * "Drie verschillen met de template" zegt wát er anders is, niet hoe het zo
 * gekomen is. Het auditlog zegt dat wel - als je de regels tenminste kunt lezen
 * die het interessantst zijn: die over dingen die er niet meer zijn.
 */
const wie = { globalName: 'Jasper', username: 'jasper' };
const toen = new Date('2026-09-20T22:10:00.000Z');

describe('een regel uit het auditlog', () => {
  it('leest een verwijderd kanaal, met de naam uit de wijziging', () => {
    // Het kanaal bestaat niet meer, dus het doel is leeg; de naam staat alleen
    // nog in wat er veranderde. Zonder die omweg zou juist deze regel - "iemand
    // heeft #media weggegooid" - geen naam hebben.
    const wijziging = leesEntry({
      action: AuditLogEvent.ChannelDelete,
      target: null,
      changes: [{ key: 'name', old: 'media' }],
      executor: wie,
      createdAt: toen,
    });

    expect(wijziging).toEqual({
      soort: 'kanaal',
      wat: 'weg',
      naam: 'media',
      door: 'Jasper',
      at: toen.toISOString(),
    });
  });

  it('leest een nieuwe rol van het doel zelf', () => {
    const wijziging = leesEntry({
      action: AuditLogEvent.RoleCreate,
      target: { name: 'Moderator' },
      executor: wie,
      createdAt: toen,
    });

    expect(wijziging).toMatchObject({ soort: 'rol', wat: 'erbij', naam: 'Moderator' });
  });

  it('noemt serverinstellingen bij naam, want die hebben er geen', () => {
    const wijziging = leesEntry({
      action: AuditLogEvent.GuildUpdate,
      target: null,
      changes: [{ key: 'verification_level', old: 1, new: 2 }],
      executor: wie,
      createdAt: toen,
    });

    expect(wijziging).toMatchObject({ soort: 'server', wat: 'anders', naam: 'serverinstellingen' });
  });

  it('slaat over wat niet over de inrichting gaat', () => {
    expect(leesEntry({ action: AuditLogEvent.MemberBanAdd, executor: wie, createdAt: toen })).toBeNull();
    expect(leesEntry({ action: AuditLogEvent.MessageDelete, executor: wie, createdAt: toen })).toBeNull();
  });

  it('zegt "onbekend" als Discord niet zegt wie het deed', () => {
    const wijziging = leesEntry({
      action: AuditLogEvent.ChannelUpdate,
      target: { name: 'algemeen' },
      executor: null,
      createdAt: toen,
    });

    expect(wijziging?.door).toBe('onbekend');
  });
});

import { describe, expect, it } from 'vitest';
import { planSetup } from '../src/planner.js';
import { toBitfield } from '../src/permissions.js';
import { parseTemplate } from '../src/types.js';
import type { GuildSnapshot } from '../src/snapshot.js';

/**
 * Twee keer dezelfde template uitrollen hoort de tweede keer niets te doen.
 * Dat ging mis: de planner vergeleek de kanaalrechten niet — de momentopname
 * bewaarde ze niet eens — en zette ze dus altijd opnieuw. Elke preview gaf
 * twintig regels "permissies", waardoor de echte wijziging wegviel.
 */
const template = parseTemplate({
  name: 'Test',
  roles: [{ key: 'lid', name: 'Lid' }],
  categories: [
    {
      name: 'Gesprekken',
      overwrites: [
        { role: '@everyone', deny: ['ViewChannel'] },
        { role: 'lid', allow: ['ViewChannel'] },
      ],
      channels: [
        { name: 'algemeen', overwrites: [{ role: 'lid', allow: ['SendMessages'] }] },
        // Geen eigen rechten: dit kanaal erft die van zijn categorie.
        { name: 'erft', overwrites: [] },
      ],
    },
  ],
});

/** Een server waarin die template al precies zo staat. */
const ingericht = (extra: { kanaalOverwrites?: unknown[]; categorieOverwrites?: unknown[] } = {}): GuildSnapshot =>
  ({
    id: 'g1',
    name: 'Server',
    roles: [
      { id: 'g1', name: '@everyone', color: 0, hoist: false, mentionable: false, permissions: 0n, position: 0, rawPosition: 0, managed: false, isEveryone: true },
      { id: 'r1', name: 'Lid', color: 0, hoist: false, mentionable: false, permissions: 0n, position: 1, rawPosition: 1, managed: false, isEveryone: false },
    ],
    categories: [
      {
        id: 'c1',
        name: 'Gesprekken',
        position: 0,
        overwrites: extra.categorieOverwrites ?? [
          { roleId: 'g1', allow: 0n, deny: toBitfield(['ViewChannel']) },
          { roleId: 'r1', allow: toBitfield(['ViewChannel']), deny: 0n },
        ],
      },
    ],
    channels: [
      {
        id: 'ch1', name: 'algemeen', type: 'text', parentId: 'c1', topic: null, nsfw: false,
        slowmodeSeconds: 0, userLimit: null, position: 0,
        overwrites: extra.kanaalOverwrites ?? [{ roleId: 'r1', allow: toBitfield(['SendMessages']), deny: 0n }],
      },
      {
        id: 'ch2', name: 'erft', type: 'text', parentId: 'c1', topic: null, nsfw: false,
        slowmodeSeconds: 0, userLimit: null, position: 1, overwrites: [],
      },
    ],
    emojis: [],
    automod: [],
  }) as unknown as GuildSnapshot;

const acties = (snapshot: GuildSnapshot) =>
  planSetup(snapshot, template, { prune: false, update: true }).actions.filter(
    (actie) => actie.kind === 'update-channel' || actie.kind === 'update-category',
  );

describe('rechten vergelijken in plaats van altijd opnieuw zetten', () => {
  it('doet niets als alles al klopt', () => {
    expect(acties(ingericht())).toEqual([]);
  });

  it('ziet het als een recht op een kanaal is veranderd', () => {
    const gewijzigd = ingericht({
      kanaalOverwrites: [{ roleId: 'r1', allow: toBitfield(['SendMessages', 'ManageMessages']), deny: 0n }],
    });

    expect(acties(gewijzigd)).toEqual([
      expect.objectContaining({ kind: 'update-channel', channelId: 'ch1', changes: ['permissies'] }),
    ]);
  });

  it('ziet het als een recht op een categorie is weggehaald', () => {
    const gewijzigd = ingericht({
      categorieOverwrites: [{ roleId: 'g1', allow: 0n, deny: toBitfield(['ViewChannel']) }],
    });

    expect(acties(gewijzigd)).toEqual([
      expect.objectContaining({ kind: 'update-category', channelId: 'c1', changes: ['permissies'] }),
    ]);
  });

  it('trekt zich niets aan van de sleutel die de bot zichzelf gaf', () => {
    // In een kanaal dat voor @everyone verstopt is, geeft de bot zichzelf
    // ViewChannel. Die rol staat niet in de template en mag niet meetellen,
    // anders blijft zo'n kanaal voor eeuwig "anders".
    const metBotSleutel = ingericht({
      categorieOverwrites: [
        { roleId: 'g1', allow: 0n, deny: toBitfield(['ViewChannel']) },
        { roleId: 'r1', allow: toBitfield(['ViewChannel']), deny: 0n },
        { roleId: 'botrol', allow: toBitfield(['ViewChannel']), deny: 0n },
      ],
    });

    expect(acties(metBotSleutel)).toEqual([]);
  });

  it('laat een kanaal zonder eigen rechten met rust — dat erft van de categorie', () => {
    const acties = planSetup(ingericht(), template, { prune: false, update: true }).actions;
    expect(acties.find((actie) => actie.kind === 'update-channel' && actie.channelId === 'ch2')).toBeUndefined();
  });

  it('zet ze wel als de rol nog niet bestaat', () => {
    const zonderRol = ingericht();
    const snapshot = { ...zonderRol, roles: zonderRol.roles.filter((rol) => rol.name !== 'Lid') };

    // Zonder die rol kan hij niets vergelijken, dus moet hij het zetten.
    expect(acties(snapshot as GuildSnapshot).length).toBeGreaterThan(0);
  });
});

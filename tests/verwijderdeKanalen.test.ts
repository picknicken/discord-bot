import { ChannelType, Collection, PermissionFlagsBits, PermissionsBitField, type Guild } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { applyPlan } from '../src/applier.js';
import { planSetup, type Plan } from '../src/planner.js';
import { parseTemplate } from '../src/types.js';
import type { GuildSnapshot } from '../src/snapshot.js';
import { standaardInstellingen } from './helpers/snapshot.js';

/**
 * Een dubbel kanaal opruimen en daarna de verwijzingen zetten, in één run.
 *
 * Dat ging mis: de lijst met namen wordt bij het inloggen gevuld, en het zojuist
 * weggegooide kanaal stond er nog in. Het systeemkanaal wees dus naar een id dat
 * niet meer bestond, en de onboarding kreeg "Unknown channel" terug — terwijl er
 * nog een kanaal met precies die naam stond.
 */
function nepServer(opties: { negeert?: boolean } = {}) {
  const kanaal = (id: string, name: string) => ({ id, name, type: ChannelType.GuildText, isThread: () => false });
  const kanalen = new Collection<string, ReturnType<typeof kanaal>>();
  // Het dubbele kanaal staat als laatste in de lijst, dus dat is het kanaal dat
  // de naam "welkom" bij het inloggen opeist - en precies dat wordt weggegooid.
  kanalen.set('blijft', kanaal('blijft', 'welkom'));
  kanalen.set('oud', kanaal('oud', 'welkom'));

  const edits: Record<string, unknown>[] = [];
  const verwijderd: string[] = [];

  const guild = {
    id: 'g1',
    name: 'Nepserver',
    features: [] as string[],
    roles: { cache: new Collection(), fetch: async () => new Collection() },
    channels: {
      cache: kanalen,
      fetch: async (id?: string) => {
        if (!id) return kanalen;
        const kanaal = kanalen.get(id);
        if (!kanaal) return null;
        return {
          ...kanaal,
          delete: async () => {
            kanalen.delete(id);
            verwijderd.push(id);
          },
        };
      },
    },
    members: {
      fetchMe: async () => ({
        id: 'bot',
        roles: { botRole: { id: 'botrol' }, highest: { position: 10, rawPosition: 10 } },
        permissions: new PermissionsBitField([PermissionFlagsBits.Administrator]),
      }),
    },
    systemChannelId: null as string | null,
    afkChannelId: null as string | null,
    rulesChannelId: null as string | null,
    publicUpdatesChannelId: null as string | null,
    edit: async (payload: Record<string, unknown>) => {
      edits.push(payload);
      // Zoals Discord: het verzoek lukt en de server is daarna bijgewerkt.
      // Met `negeert` doet hij wat hij in het echt soms ook doet - "gelukt"
      // antwoorden en niets veranderen.
      if (!opties.negeert && typeof payload.systemChannel === 'string') {
        guild.systemChannelId = payload.systemChannel;
      }
      return guild;
    },
  };

  return { guild: guild as unknown as Guild, edits, verwijderd, kanalen };
}

const template = parseTemplate({
  name: 'Test',
  guild: { systemChannel: 'welkom' },
  categories: [{ name: 'Info', channels: [{ name: 'welkom' }] }],
});

const plan: Plan = {
  templateName: 'Test',
  options: { prune: true, update: true },
  actions: [
    { kind: 'delete-channel', channelId: 'oud', name: 'welkom', isCategory: false },
    { kind: 'guild-settings', changes: ['systemChannel'] },
  ],
  warnings: [],
};

describe('een verwijderd kanaal uit de naamlijst halen', () => {
  it('zet de verwijzing op het kanaal dat blijft staan', async () => {
    const nep = nepServer();
    const result = await applyPlan(nep.guild, template, plan);

    expect(nep.verwijderd).toEqual(['oud']);
    expect(result.errors).toEqual([]);
    expect(nep.edits.some((edit) => edit.systemChannel === 'blijft')).toBe(true);
    expect(nep.edits.some((edit) => edit.systemChannel === 'oud')).toBe(false);
  });
});

describe('opruimen gaat als laatste', () => {
  /**
   * Discord weigert het regelskanaal van een community-server te verwijderen.
   * Stond het opruimen vooraan, dan mislukte dat verwijderen en werd de
   * verwijzing pas daarna verzet - dus was er altijd een tweede ronde nodig.
   */
  const snapshot: GuildSnapshot = {
    id: 'g1',
    name: 'Server',
    roles: [],
    categories: [],
    channels: [
      {
        id: 'blijft', name: 'welkom', type: 'text', parentId: null, topic: null, nsfw: false,
        slowmodeSeconds: 0, userLimit: null, position: 0, overwrites: [],
      },
      {
        id: 'oud', name: 'oude-troep', type: 'text', parentId: null, topic: null, nsfw: false,
        slowmodeSeconds: 0, userLimit: null, position: 1, overwrites: [],
      },
    ],
    emojis: [],
    automod: [],
    settings: { ...standaardInstellingen },
    onboarding: null,
  };

  it('zet de serverinstellingen voor het verwijderen', () => {
    const soorten = planSetup(snapshot, template, { prune: true, update: true }).actions.map((actie) => actie.kind);

    expect(soorten).toContain('delete-channel');
    expect(soorten).toContain('guild-settings');
    expect(soorten.indexOf('delete-channel')).toBeGreaterThan(soorten.indexOf('guild-settings'));
  });
});

describe('gelukt is niet hetzelfde als gedaan', () => {
  it('meldt het als Discord de verwijzing niet overneemt', async () => {
    // Dit kostte een ochtend zoeken: de bot meldde elke keer dat het
    // regelskanaal gezet was, terwijl de preview daarna bleef zeggen dat het
    // anders was. Discord gaf geen fout; hij deed het gewoon niet.
    const nep = nepServer({ negeert: true });
    const result = await applyPlan(nep.guild, template, plan);

    expect(result.errors.join(' ')).toContain('systeemkanaal niet overgenomen');
  });

  it('zegt niets als het wel gelukt is', async () => {
    const nep = nepServer();
    const result = await applyPlan(nep.guild, template, plan);

    expect(result.errors).toEqual([]);
  });
});

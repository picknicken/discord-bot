import {
  ChannelType,
  Collection,
  GuildVerificationLevel,
  PermissionFlagsBits,
  PermissionsBitField,
  type Guild,
} from 'discord.js';
import { describe, expect, it } from 'vitest';
import { applyPlan } from '../src/applier.js';
import { planSetup } from '../src/planner.js';
import { parseTemplate } from '../src/types.js';
import type { GuildSnapshot } from '../src/snapshot.js';

/**
 * Een namaakserver die alleen onthoudt wat er naar Discord zou gaan. Dat bewijst
 * niet hoe Discord reageert, maar wel wat wij sturen — en precies dáár zaten de
 * mislukte runs: twee opdrachten waar er één hoorde, en verwijzingen die elkaar
 * meesleurden.
 */
function nepServer(opties: { features?: string[]; faalOp?: (payload: Record<string, unknown>) => string | null } = {}) {
  const edits: Record<string, unknown>[] = [];
  const kanalen = new Collection<string, { id: string; name: string; type: ChannelType }>();
  let teller = 0;

  const guild = {
    id: 'g1',
    name: 'Nepserver',
    features: opties.features ?? [],
    roles: {
      cache: new Collection(),
      create: async ({ name }: { name: string }) => ({ id: `r${++teller}`, name }),
      fetch: async () => undefined,
      setPositions: async () => undefined,
    },
    channels: {
      cache: kanalen,
      create: async ({ name, type }: { name: string; type?: ChannelType }) => {
        const kanaal = { id: `c${++teller}`, name, type: type ?? ChannelType.GuildText };
        kanalen.set(kanaal.id, kanaal);
        return { ...kanaal, isThread: () => false };
      },
      fetch: async (id?: string) => (id ? kanalen.get(id) ?? null : undefined),
      setPositions: async () => undefined,
    },
    members: {
      fetchMe: async () => ({
        id: 'bot',
        roles: { botRole: { id: 'botrol' }, highest: { position: 10 } },
        permissions: new PermissionsBitField([PermissionFlagsBits.Administrator]),
      }),
    },
    autoModerationRules: { create: async () => undefined, delete: async () => undefined },
    edit: async (payload: Record<string, unknown>) => {
      const fout = opties.faalOp?.(payload);
      if (fout) throw new Error(fout);
      edits.push(payload);
      if (Array.isArray(payload.features)) guild.features = payload.features as string[];
      return guild;
    },
  };

  return { guild: guild as unknown as Guild, edits, kanalen };
}

const leeg: GuildSnapshot = {
  id: 'g1', name: 'Nepserver', roles: [], categories: [], channels: [], emojis: [], automod: [],
} as unknown as GuildSnapshot;

const template = parseTemplate({
  name: 'Test',
  guild: {
    community: true,
    verificationLevel: 'medium',
    systemChannel: 'welkom',
    rulesChannel: 'regels',
    updatesChannel: 'updates',
  },
  roles: [{ key: 'mod', name: 'Mod', permissions: ['KickMembers'] }],
  categories: [
    {
      name: 'Info',
      channels: [{ name: 'welkom' }, { name: 'regels' }, { name: 'updates' }, { name: 'nieuws', type: 'announcement' }],
    },
  ],
});

const rollen = async (opties?: Parameters<typeof nepServer>[0]) => {
  const nep = nepServer(opties);
  const plan = planSetup(leeg, template, { prune: false, update: true });
  const result = await applyPlan(nep.guild, template, plan);
  return { ...nep, result };
};

describe('wat er naar Discord gaat', () => {
  it('zet community-modus in één opdracht aan, met de kanalen erbij', async () => {
    const { edits } = await rollen();
    const community = edits.find((edit) => Array.isArray(edit.features));

    expect(community).toBeDefined();
    expect(community?.features).toContain('COMMUNITY');
    expect(community?.rulesChannel).toBeTruthy();
    expect(community?.publicUpdatesChannel).toBeTruthy();
    expect(community?.explicitContentFilter).toBeDefined();
  });

  it('maakt het aankondigingskanaal pas nadat community aanstaat', async () => {
    const { guild, kanalen } = await rollen();
    const volgorde = [...kanalen.values()].map((kanaal) => kanaal.name);
    expect(volgorde.indexOf('nieuws')).toBeGreaterThan(volgorde.indexOf('regels'));
    expect((guild as unknown as { features: string[] }).features).toContain('COMMUNITY');
  });

  it('zet elke kanaalverwijzing in een eigen opdracht', async () => {
    const { edits } = await rollen();
    const verwijzingen = edits.filter(
      (edit) => edit.systemChannel || (edit.rulesChannel && !Array.isArray(edit.features)),
    );
    for (const edit of verwijzingen) {
      const velden = Object.keys(edit).filter((key) => key !== 'reason');
      expect(velden).toHaveLength(1);
    }
  });

  it('laat het systeemkanaal staan als Discord het regelskanaal weigert', async () => {
    // Dit ging eerder mis: alles zat in één opdracht, dus één weigering nam de rest mee.
    const { edits, result } = await rollen({
      faalOp: (payload) => (payload.rulesChannel && !Array.isArray(payload.features) ? 'Invalid Form Body' : null),
    });

    expect(edits.some((edit) => edit.systemChannel)).toBe(true);
    expect(result.errors.join(' ')).toContain('regelskanaal niet gezet');
  });

  it('noemt in de fout welke rol of welk kanaal het niet deed', async () => {
    const nep = nepServer();
    nep.guild.roles.create = (async () => {
      throw new Error('Missing Permissions');
    }) as never;

    const plan = planSetup(leeg, template, { prune: false, update: true });
    const result = await applyPlan(nep.guild, template, plan);
    expect(result.errors[0]).toBe('create-role @Mod: Missing Permissions');
  });

  it('tilt verificatie op tot wat een community-server verdraagt', async () => {
    const { edits } = await rollen();
    const instellingen = edits.find((edit) => edit.verificationLevel !== undefined && !Array.isArray(edit.features));
    expect(instellingen?.verificationLevel).toBe(GuildVerificationLevel.Medium);
    expect(instellingen?.explicitContentFilter).toBe(2);
  });
});

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
import { maakHaalbaar } from '../src/haalbaar.js';
import { parseTemplate } from '../src/types.js';
import type { GuildSnapshot } from '../src/snapshot.js';

/**
 * Een namaakserver die alleen onthoudt wat er naar Discord zou gaan. Dat bewijst
 * niet hoe Discord reageert, maar wel wat wij sturen — en precies dáár zaten de
 * mislukte runs: twee opdrachten waar er één hoorde, en verwijzingen die elkaar
 * meesleurden.
 */
function nepServer(
  opties: {
    features?: string[];
    faalOp?: (payload: Record<string, unknown>) => string | null;
    rechten?: PermissionsBitField;
  } = {},
) {
  const edits: Record<string, unknown>[] = [];
  const rollen: { name: string; permissions: bigint }[] = [];
  const kanalen = new Collection<string, { id: string; name: string; type: ChannelType }>();
  let teller = 0;

  const guild = {
    id: 'g1',
    name: 'Nepserver',
    features: opties.features ?? [],
    roles: {
      cache: new Collection(),
      create: async ({ name, permissions }: { name: string; permissions?: bigint }) => {
        rollen.push({ name, permissions: permissions ?? 0n });
        return { id: `r${++teller}`, name };
      },
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
        permissions: opties.rechten ?? new PermissionsBitField([PermissionFlagsBits.Administrator]),
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

  return { guild: guild as unknown as Guild, edits, kanalen, rollen };
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

/** Zoals het echt gaat: eerst bijstellen naar wat de bot mag, dan uitvoeren. */
const draaiMetRechten = async (rechten: PermissionsBitField, features: string[] = []) => {
  const nep = nepServer({ rechten, features });
  const plan = planSetup(leeg, template, { prune: false, update: true });
  const haalbaar = maakHaalbaar(plan, rechten, { alCommunity: features.includes('COMMUNITY') });
  const result = await applyPlan(nep.guild, template, haalbaar.plan);
  return { ...nep, result, aanpassingen: haalbaar.aanpassingen };
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


describe('een bot zonder Administrator', () => {
  const beperkt = new PermissionsBitField([
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.ManageRoles,
    PermissionFlagsBits.ManageGuild,
    PermissionFlagsBits.KickMembers,
  ]);

  it('draait de template zonder ook maar één mislukte actie', async () => {
    const { result } = await draaiMetRechten(beperkt);
    expect(result.failed, result.errors.join(' | ')).toBe(0);
    expect(result.applied).toBeGreaterThan(0);
  });

  it('maakt de rollen aan, maar zonder de rechten die hij niet mag uitdelen', async () => {
    const { rollen: gemaakt } = await draaiMetRechten(beperkt);
    const mod = gemaakt.find((rol) => rol.name === 'Mod');

    expect(mod).toBeDefined();
    expect(mod!.permissions & PermissionFlagsBits.KickMembers).toBe(PermissionFlagsBits.KickMembers);
    expect(mod!.permissions & PermissionFlagsBits.Administrator).toBe(0n);
  });

  it('probeert community-modus niet eens aan te zetten', async () => {
    const { edits } = await draaiMetRechten(beperkt);
    expect(edits.some((edit) => Array.isArray(edit.features))).toBe(false);
  });

  it('slaat de kanalen over die community nodig hebben, en zegt dat', async () => {
    const { kanalen, aanpassingen } = await draaiMetRechten(beperkt);
    const namen = [...kanalen.values()].map((kanaal) => kanaal.name);

    expect(namen).toContain('welkom');
    expect(namen).not.toContain('nieuws');
    expect(aanpassingen.join(' ')).toContain('community-modus overgeslagen');
  });

  it('maakt ze wel op een server die al community is', async () => {
    const { kanalen, result } = await draaiMetRechten(beperkt, ['COMMUNITY']);
    expect([...kanalen.values()].map((kanaal) => kanaal.name)).toContain('nieuws');
    expect(result.failed, result.errors.join(' | ')).toBe(0);
  });

  it('zegt per rol en per kanaal wat er niet gezet is', async () => {
    const { aanpassingen } = await draaiMetRechten(new PermissionsBitField([PermissionFlagsBits.ManageChannels]));
    expect(aanpassingen.join(' | ')).toContain('rol @Mod: KickMembers niet gezet');
  });

  it('knipt het er ook af als het plan niet bijgesteld is', async () => {
    // De vangnetlaag: zelfs met een plan dat wel om Administrator vraagt, gaat
    // er geen recht naar Discord dat de bot niet heeft.
    const nep = nepServer({ rechten: new PermissionsBitField([PermissionFlagsBits.ManageRoles]) });
    const plan = planSetup(leeg, template, { prune: false, update: true });
    const result = await applyPlan(nep.guild, template, plan);

    const mod = nep.rollen.find((rol) => rol.name === 'Mod');
    expect(mod!.permissions & PermissionFlagsBits.KickMembers).toBe(0n);
    expect(result.errors.join(' | ')).toContain('Rol @Mod aangemaakt zonder KickMembers');
  });
});

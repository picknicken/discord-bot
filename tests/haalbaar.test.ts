import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { grantableBits, maakHaalbaar, veiligeBits } from '../src/haalbaar.js';
import { planShortfalls } from '../src/preflight.js';
import { BEPERKTE_PERMISSIONS } from '../src/botPermissions.js';
import { planSetup, type Plan } from '../src/planner.js';
import { listTemplateIds, loadTemplate } from '../src/templates.js';
import { parseTemplate } from '../src/types.js';
import { standaardInstellingen } from './helpers/snapshot.js';
import type { GuildSnapshot } from '../src/snapshot.js';

const leeg: GuildSnapshot = {
  id: 'g1', name: 'Leeg', roles: [], categories: [], channels: [], emojis: [], automod: [],
  settings: standaardInstellingen, onboarding: null,
} as unknown as GuildSnapshot;

const bot = (...permissions: bigint[]) => new PermissionsBitField(permissions);
const admin = bot(PermissionFlagsBits.Administrator);

const template = parseTemplate({
  name: 'Test',
  guild: { community: true, rulesChannel: 'regels', updatesChannel: 'updates' },
  roles: [
    { key: 'baas', name: 'Baas', permissions: ['Administrator'] },
    { key: 'mod', name: 'Mod', permissions: ['KickMembers', 'ManageChannels'] },
  ],
  categories: [
    {
      name: 'Info',
      overwrites: [{ role: 'mod', allow: ['MentionEveryone', 'ManageChannels'] }],
      channels: [
        { name: 'regels' },
        { name: 'updates' },
        { name: 'nieuws', type: 'announcement' },
        { name: 'vragen', type: 'forum' },
      ],
    },
  ],
  onboarding: { enabled: true, defaultChannels: ['regels'] },
});

const plan = (): Plan => planSetup(leeg, template, { prune: false, update: true });

describe('bits veilig samenvoegen', () => {
  const A = PermissionFlagsBits.KickMembers;
  const B = PermissionFlagsBits.BanMembers;

  it('zet wat mag', () => {
    expect(veiligeBits(A, 0n, A)).toBe(A);
  });

  it('laat staan wat de bot niet mag aanraken', () => {
    // De rol heeft B al; de bot mag alleen A. B blijft dus staan.
    expect(veiligeBits(A, B, A)).toBe(A | B);
  });

  it('haalt niets weg dat de bot niet mag uitdelen', () => {
    expect(veiligeBits(0n, B, A) & B).toBe(B);
  });

  it('haalt wel weg wat de bot wel mag', () => {
    expect(veiligeBits(0n, A, A) & A).toBe(0n);
  });

  it('geeft een bot met Administrator alles', () => {
    expect(grantableBits(admin) & PermissionFlagsBits.BanMembers).toBe(PermissionFlagsBits.BanMembers);
  });
});

describe('een plan haalbaar maken', () => {
  it('laat alles staan voor een bot met Administrator', () => {
    const uit = maakHaalbaar(plan(), admin);
    expect(uit.aanpassingen).toEqual([]);
    expect(uit.plan.actions).toHaveLength(plan().actions.length);
  });

  it('knipt uit een rol de rechten die de bot zelf niet heeft', () => {
    const uit = maakHaalbaar(plan(), bot(PermissionFlagsBits.KickMembers, PermissionFlagsBits.ManageRoles));
    const baas = uit.plan.actions.find((a) => a.kind === 'create-role' && a.role.name === 'Baas');
    expect(baas?.kind === 'create-role' && baas.role.permissions).toEqual([]);
    expect(uit.aanpassingen.join(' ')).toContain('rol @Baas: Administrator niet gezet');
  });

  it('houdt de rechten die de bot wel heeft', () => {
    const uit = maakHaalbaar(plan(), bot(PermissionFlagsBits.KickMembers));
    const mod = uit.plan.actions.find((a) => a.kind === 'create-role' && a.role.name === 'Mod');
    expect(mod?.kind === 'create-role' && mod.role.permissions).toEqual(['KickMembers']);
  });

  it('slaat community-modus over zonder Administrator', () => {
    const uit = maakHaalbaar(plan(), BEPERKTE_PERMISSIONS);
    expect(uit.plan.actions.some((a) => a.kind === 'guild-community')).toBe(false);
    expect(uit.aanpassingen.join(' ')).toContain('community-modus overgeslagen');
  });

  it('slaat de kanalen over die community nodig hebben', () => {
    const uit = maakHaalbaar(plan(), BEPERKTE_PERMISSIONS);
    const namen = uit.plan.actions.flatMap((a) => (a.kind === 'create-channel' ? [a.channel.name] : []));
    expect(namen).toContain('regels');
    expect(namen).not.toContain('nieuws');
    expect(namen).not.toContain('vragen');
    expect(uit.aanpassingen.join(' ')).toContain('overgeslagen: die bestaan alleen op een community-server');
  });

  it('maakt ze wel als de server al een community-server is', () => {
    const uit = maakHaalbaar(plan(), BEPERKTE_PERMISSIONS, { alCommunity: true });
    const namen = uit.plan.actions.flatMap((a) => (a.kind === 'create-channel' ? [a.channel.name] : []));
    expect(namen).toContain('nieuws');
    expect(uit.plan.actions.some((a) => a.kind === 'guild-community')).toBe(false);
  });

  it('slaat onboarding over als community niet aan kan', () => {
    const uit = maakHaalbaar(plan(), BEPERKTE_PERMISSIONS);
    expect(uit.plan.actions.some((a) => a.kind === 'onboarding')).toBe(false);
    expect(uit.aanpassingen.join(' ')).toContain('onboarding overgeslagen');
  });

  it('knipt rechten uit een categorie die de bot niet mag uitdelen', () => {
    const uit = maakHaalbaar(plan(), bot(PermissionFlagsBits.ManageChannels));
    const info = uit.plan.actions.find((a) => a.kind === 'create-category');
    const allow = info?.kind === 'create-category' ? info.category.overwrites[0]?.allow : undefined;
    expect(allow).toEqual(['ManageChannels']);
    expect(uit.aanpassingen.join(' ')).toContain('MentionEveryone niet gezet');
  });

  it('zegt erbij wat je eraan doet', () => {
    expect(maakHaalbaar(plan(), BEPERKTE_PERMISSIONS).aanpassingen.join(' ')).toContain(
      'Geef de bot Administrator',
    );
  });

  it('houdt het plan uitvoerbaar: er blijft niets over dat de bot niet mag', () => {
    const uit = maakHaalbaar(plan(), BEPERKTE_PERMISSIONS);
    expect(planShortfalls(uit.plan, BEPERKTE_PERMISSIONS)).toEqual([]);
  });
});

/**
 * De garantie waar het om gaat: welke template er ook in de map staat - nu of
 * later - het bijgestelde plan vraagt nooit iets wat de bot niet mag. Zet
 * iemand er morgen een template bij met een beheerdersrol, dan valt deze test
 * om zodra dat niet meer klopt.
 */
describe('elke template in de map', () => {
  const botten: [string, PermissionsBitField][] = [
    ['een bot met Administrator', admin],
    ['een bot met de beperkte rechten', BEPERKTE_PERMISSIONS],
    ['een bot met alleen kanalen en rollen', bot(PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles)],
    ['een bot zonder iets', new PermissionsBitField()],
  ];

  it('levert voor elke bot een plan op dat niets onmogelijks vraagt', async () => {
    const ids = await listTemplateIds('./templates');
    expect(ids.length).toBeGreaterThan(0);

    for (const id of ids) {
      const geladen = await loadTemplate('./templates', id);
      const volledig = planSetup(leeg, geladen, { prune: false, update: true });

      for (const [naam, rechten] of botten) {
        for (const alCommunity of [false, true]) {
          const uit = maakHaalbaar(volledig, rechten, { alCommunity });
          const tekort = planShortfalls(uit.plan, rechten);
          expect(tekort, `${id} met ${naam} (alCommunity=${alCommunity}): ${JSON.stringify(tekort)}`).toEqual([]);
        }
      }
    }
  });

  it('laat voor een bot met Administrator elke template ongemoeid', async () => {
    for (const id of await listTemplateIds('./templates')) {
      const geladen = await loadTemplate('./templates', id);
      const volledig = planSetup(leeg, geladen, { prune: false, update: true });
      expect(maakHaalbaar(volledig, admin).aanpassingen, id).toEqual([]);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { planSetup, type PlanAction } from '../src/planner.js';
import { parseTemplate } from '../src/types.js';
import type { GuildSnapshot, SnapshotOnboarding, SnapshotSettings } from '../src/snapshot.js';
import { snapshotAutomod, standaardInstellingen } from './helpers/snapshot.js';

/**
 * Serverinstellingen, AutoMod en onboarding werden altijd opnieuw gezet: de
 * planner keek er niet naar, hij las alleen wat de template noemde. Gevolg: elke
 * preview drie regels die er niet hoorden, en - vervelender - community-modus die
 * bij elke uitrol opnieuw naar Discord ging.
 *
 * Half vergelijken zou erger zijn dan niet vergelijken: dan blijft een echte
 * wijziging stilletjes liggen. Vandaar dat hier ook staat wat er wél moet gebeuren.
 */
const kanaal = (id: string, name: string, position: number) => ({
  id, name, type: 'text' as const, parentId: null, topic: null, nsfw: false,
  slowmodeSeconds: 0, userLimit: null, position, overwrites: [],
});

const server = (extra: { settings?: Partial<SnapshotSettings>; automod?: GuildSnapshot['automod']; onboarding?: SnapshotOnboarding | null } = {}): GuildSnapshot => ({
  id: 'g1',
  name: 'Server',
  roles: [
    { id: 'g1', name: '@everyone', color: 0, hoist: false, mentionable: false, permissions: 0n, position: 0, rawPosition: 0, managed: false, isEveryone: true },
    { id: 'r1', name: 'Lid', color: 0, hoist: false, mentionable: false, permissions: 0n, position: 1, rawPosition: 1, managed: false, isEveryone: false },
  ],
  categories: [],
  channels: [kanaal('ch1', 'welkom', 0), kanaal('ch2', 'regels', 1), kanaal('ch3', 'updates', 2)],
  emojis: [],
  automod: extra.automod ?? [],
  settings: { ...standaardInstellingen, ...extra.settings },
  onboarding: extra.onboarding ?? null,
});

const maak = (stuk: Record<string, unknown>) =>
  parseTemplate({
    name: 'Test',
    roles: [{ key: 'lid', name: 'Lid' }],
    uncategorizedChannels: [{ name: 'welkom' }, { name: 'regels' }, { name: 'updates' }],
    ...stuk,
  });

const acties = (snapshot: GuildSnapshot, template: ReturnType<typeof maak>, soort: PlanAction['kind']) =>
  planSetup(snapshot, template, { prune: false, update: true }).actions.filter((actie) => actie.kind === soort);

describe('serverinstellingen vergelijken', () => {
  const template = maak({ guild: { verificationLevel: 'low', systemChannel: 'welkom' } });

  it('doet niets als ze al kloppen', () => {
    const snapshot = server({ settings: { verificationLevel: 'low', systemChannelId: 'ch1' } });
    expect(acties(snapshot, template, 'guild-settings')).toEqual([]);
  });

  it('ziet een afwijkende verificatie', () => {
    const snapshot = server({ settings: { verificationLevel: 'high', systemChannelId: 'ch1' } });
    expect(acties(snapshot, template, 'guild-settings')).toEqual([
      expect.objectContaining({ changes: ['verificationLevel'] }),
    ]);
  });

  it('ziet een systeemkanaal dat nog nergens naar wijst', () => {
    const snapshot = server({ settings: { verificationLevel: 'low' } });
    expect(acties(snapshot, template, 'guild-settings')).toEqual([
      expect.objectContaining({ changes: ['systemChannel'] }),
    ]);
  });

  it('zwijgt over wat Discord op een community-server zelf afdwingt', () => {
    // Filter op alle leden en verificatie minstens laag: dat stuurt de applier
    // altijd mee op een community-server. Staat het al zo, dan is er niets te doen.
    const communityTemplate = maak({ guild: { community: true, rulesChannel: 'regels', updatesChannel: 'updates' } });
    const snapshot = server({
      settings: {
        community: true,
        verificationLevel: 'low',
        explicitContentFilter: 'all_members',
        rulesChannelId: 'ch2',
        updatesChannelId: 'ch3',
      },
    });

    expect(acties(snapshot, communityTemplate, 'guild-settings')).toEqual([]);
  });

  it('zet community-modus wel aan als die nog uit staat', () => {
    const communityTemplate = maak({ guild: { community: true, rulesChannel: 'regels', updatesChannel: 'updates' } });
    const gevonden = acties(server(), communityTemplate, 'guild-settings');

    expect(gevonden).toHaveLength(1);
    expect(gevonden[0]).toEqual(expect.objectContaining({ kind: 'guild-settings' }));
    expect(gevonden[0] && 'changes' in gevonden[0] ? gevonden[0].changes : []).toContain('community');
  });

  it('laat een regelskanaal met rust op een server die geen community is', () => {
    // Discord weigert het daar, dus de applier slaat het over; het als verschil
    // blijven melden zou een regel opleveren die nooit weggaat.
    const template = maak({ guild: { rulesChannel: 'regels' } });
    expect(acties(server(), template, 'guild-settings')).toEqual([]);
  });
});

describe('automod-regels vergelijken', () => {
  it('laat een regel die al klopt met rust', () => {
    const template = maak({ automod: [{ name: 'Spam', trigger: 'spam' }] });
    const snapshot = server({ automod: [snapshotAutomod('a1', 'Spam')] });

    expect(acties(snapshot, template, 'update-automod')).toEqual([]);
  });

  it('trekt zich niets aan van volgorde en hoofdletters in de woordenlijst', () => {
    const template = maak({ automod: [{ name: 'Woorden', trigger: 'keyword', keywords: ['aap', 'noot'] }] });
    const snapshot = server({
      automod: [snapshotAutomod('a1', 'Woorden', { trigger: 'keyword', keywords: ['Noot', 'aap'] })],
    });

    expect(acties(snapshot, template, 'update-automod')).toEqual([]);
  });

  it('werkt hem bij als er een woord bij is gekomen', () => {
    const template = maak({ automod: [{ name: 'Woorden', trigger: 'keyword', keywords: ['aap', 'noot', 'mies'] }] });
    const snapshot = server({
      automod: [snapshotAutomod('a1', 'Woorden', { trigger: 'keyword', keywords: ['aap', 'noot'] })],
    });

    expect(acties(snapshot, template, 'update-automod')).toEqual([
      expect.objectContaining({ ruleId: 'a1' }),
    ]);
  });

  it('kijkt ook naar de rollen die de regel overslaan', () => {
    const template = maak({ automod: [{ name: 'Spam', trigger: 'spam', exemptRoles: ['lid'] }] });
    const gelijk = server({ automod: [snapshotAutomod('a1', 'Spam', { exemptRoleIds: ['r1'] })] });
    const anders = server({ automod: [snapshotAutomod('a1', 'Spam')] });

    expect(acties(gelijk, template, 'update-automod')).toEqual([]);
    expect(acties(anders, template, 'update-automod')).toHaveLength(1);
  });

  it('ziet een andere actie', () => {
    const template = maak({ automod: [{ name: 'Spam', trigger: 'spam', action: 'timeout', timeoutSeconds: 60 }] });
    const snapshot = server({ automod: [snapshotAutomod('a1', 'Spam')] });

    expect(acties(snapshot, template, 'update-automod')).toHaveLength(1);
  });
});

describe('onboarding vergelijken', () => {
  const template = maak({
    onboarding: {
      prompts: [
        { title: 'Waar kom je voor?', options: [{ title: 'Chatten', roles: ['lid'], channels: ['welkom'] }] },
      ],
    },
  });

  const staatErOp: SnapshotOnboarding = {
    enabled: true,
    mode: 'default',
    defaultChannelIds: [],
    prompts: [
      {
        title: 'Waar kom je voor?',
        singleSelect: false,
        required: false,
        options: [{ title: 'Chatten', description: null, emoji: null, roleIds: ['r1'], channelIds: ['ch1'] }],
      },
    ],
  };

  it('doet niets als hij er al zo op staat', () => {
    expect(acties(server({ onboarding: staatErOp }), template, 'onboarding')).toEqual([]);
  });

  it('zet hem als een vraag anders heet', () => {
    const anders = { ...staatErOp, prompts: [{ ...staatErOp.prompts[0]!, title: 'Wat doe je hier?' }] };
    expect(acties(server({ onboarding: anders }), template, 'onboarding')).toHaveLength(1);
  });

  it('zet hem als er een rol bij een keuze is weggevallen', () => {
    const vraag = staatErOp.prompts[0]!;
    const optie = vraag.options[0]!;
    const anders = {
      ...staatErOp,
      prompts: [{ ...vraag, options: [{ ...optie, roleIds: [] }] }],
    };

    expect(acties(server({ onboarding: anders }), template, 'onboarding')).toHaveLength(1);
  });

  it('zet hem gewoon als de onboarding niet opgehaald kon worden', () => {
    expect(acties(server({ onboarding: null }), template, 'onboarding')).toHaveLength(1);
  });
});

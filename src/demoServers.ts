import {
  AuditLogEvent,
  ChannelType,
  Collection,
  GuildDefaultMessageNotifications,
  GuildExplicitContentFilter,
  GuildOnboardingMode,
  GuildVerificationLevel,
  PermissionFlagsBits,
  PermissionsBitField,
} from 'discord.js';

/**
 * Nagemaakte servers voor de demo- en ontwikkelmodus.
 *
 * Een dashboard bouwen op één brave server gaat mis: de schermen die ertoe doen
 * zijn juist die waar iets níet klopt. Hier staan ze allemaal naast elkaar — een
 * server die klopt, een die is afgedwaald, een lege, en een waar de bot te weinig
 * rechten heeft en onder een rol staat. Zo zie je bij elke wijziging in één
 * oogopslag hoe alle vier de gevallen eruitzien, zonder Discord aan te raken.
 */

export type DemoScenario = 'klopt' | 'afgeweken' | 'leeg' | 'kapot';

const rol = (id: string, name: string, position: number, color = 0x99aab5, managed = false) => ({
  id,
  name,
  color,
  hoist: false,
  mentionable: false,
  // position is de nette volgorde, rawPosition het nummer dat Discord bewaart.
  // Allebei nodig: de code vergelijkt met het eerste en stuurt het tweede terug.
  permissions: new PermissionsBitField(0n),
  position,
  rawPosition: position,
  managed,
});

/** Een bericht-id van zoveel dagen geleden; daar leest de opruimlijst de stilte uit af. */
const berichtVan = (dagenGeleden: number) =>
  String((BigInt(Date.now() - dagenGeleden * 86400000 - 1420070400000) << 22n) | 1n);

const kanaal = (
  id: string,
  name: string,
  type: ChannelType,
  parentId: string | null,
  position = 0,
  stilSinds: number | null = 1,
) => ({
  id,
  name,
  type,
  parentId,
  rawPosition: position,
  topic: null,
  nsfw: false,
  rateLimitPerUser: 0,
  userLimit: 0,
  lastMessageId: stilSinds === null ? null : berichtVan(stilSinds),
  isThread: () => false,
  permissionOverwrites: { cache: new Collection() },
});

interface DemoOpties {
  id: string;
  naam: string;
  leden: number;
  scenario: DemoScenario;
}

/** Wat er in de server staat, per geval. */
function inhoud(id: string, scenario: DemoScenario) {
  const roles = new Collection<string, ReturnType<typeof rol>>();
  const channels = new Collection<string, ReturnType<typeof kanaal>>();
  roles.set(id, rol(id, '@everyone', 0));

  if (scenario === 'leeg') return { roles, channels };

  roles.set('r1', rol('r1', 'Lid', 1, 0x57f287));
  roles.set('r2', rol('r2', 'Oud-lid', 2, 0x99aab5));
  roles.set('r3', rol('r3', 'Een andere bot', 3, 0x5865f2, true));

  // Staat boven de bot (die op 4 staat), dus die rol kan de bot niet aanpassen.
  if (scenario === 'kapot') roles.set('r4', rol('r4', 'Moderator', 8, 0xed4245));

  for (const c of [
    kanaal('c1', 'Welkom', ChannelType.GuildCategory, null, 0),
    kanaal('c2', 'welkom', ChannelType.GuildText, 'c1', 0),
    kanaal('c3', 'Gesprekken', ChannelType.GuildCategory, null, 1),
    // In de kapotte server is "algemeen" een spraakkanaal terwijl elke template
    // er een tekstkanaal van maakt: het geval waarin bijwerken niet kan en
    // alleen opnieuw aanmaken helpt.
    kanaal('c4', 'algemeen', scenario === 'kapot' ? ChannelType.GuildVoice : ChannelType.GuildText, 'c3', 0),
  ]) {
    channels.set(c.id, c);
  }

  if (scenario !== 'klopt') {
    // Rommel die niet in de template staat; zichtbaar in het vergelijkscherm.
    for (const c of [
      // Al een half jaar stil, en eentje waar nooit iets in gezegd is: precies
      // wat er in de opruimlijst hoort te staan.
      kanaal('c5', 'oude-memes', ChannelType.GuildText, 'c3', 1, 190),
      kanaal('c6', 'Archief', ChannelType.GuildCategory, null, 2),
      kanaal('c7', 'stof', ChannelType.GuildText, 'c6', 0, null),
    ]) {
      channels.set(c.id, c);
    }
  }

  return { roles, channels };
}

const ALLE_RECHTEN =
  PermissionFlagsBits.ManageChannels | PermissionFlagsBits.ManageRoles | PermissionFlagsBits.ManageGuild;

export function demoServer({ id, naam, leden, scenario }: DemoOpties) {
  const { roles, channels } = inhoud(id, scenario);

  // De kapotte server: de bot mag geen rollen beheren. Dat is geen verzinsel —
  // het is precies wat er gebeurt als iemand de bot handmatig toevoegt zonder
  // de aangeboden rechten.
  const rechten =
    scenario === 'kapot'
      ? PermissionFlagsBits.ManageChannels | PermissionFlagsBits.ManageGuild
      : scenario === 'leeg'
        ? PermissionFlagsBits.ViewChannel
        : ALLE_RECHTEN;

  return {
    id,
    name: naam,
    memberCount: leden,
    scenario,
    iconURL: () => null,
    description: null,
    features: [] as string[],
    systemChannelId: null,
    afkChannelId: null,
    rulesChannelId: null,
    publicUpdatesChannelId: null,
    roles: { cache: roles },
    channels: { cache: channels },
    emojis: { cache: new Collection() },
    autoModerationRules: { cache: new Collection(), fetch: async () => new Collection() },
    verificationLevel: GuildVerificationLevel.None,
    explicitContentFilter: GuildExplicitContentFilter.Disabled,
    defaultMessageNotifications: GuildDefaultMessageNotifications.AllMessages,
    afkTimeout: 300,
    // Een auditlog met wat er in zo'n server gebeurt, zodat het scherm
    // "wie heeft wat veranderd" ook zonder Discord iets laat zien.
    fetchAuditLogs: async () => ({ entries: nepAuditlog(scenario) }),
    // Een eeuwige uitnodiging en een vergeten webhook, voor de opruimlijst.
    invites: {
      fetch: async () =>
        new Collection([
          ['abc123', { code: 'abc123', maxAge: 0, uses: 42, inviter: { globalName: 'Jasper', username: 'jasper' } }],
          ['tijdelijk', { code: 'tijdelijk', maxAge: 86400, uses: 3, inviter: null }],
        ]),
    },
    fetchWebhooks: async () =>
      new Collection([
        ['w1', { name: 'Oude statuspagina', channelId: 'c2', owner: { username: 'jasper' } }],
      ]),
    fetchOnboarding: async () => ({
      enabled: false,
      mode: GuildOnboardingMode.OnboardingDefault,
      defaultChannels: new Collection(),
      prompts: new Collection(),
    }),
    members: {
      // De demo heeft geen ledenlijst; de opruimlijst zegt dan netjes dat hij
      // niet kan beoordelen welke rollen niemand heeft.
      fetch: async () => {
        throw new Error('geen ledenlijst in de demo');
      },
      fetchMe: async () => ({
        permissions: new PermissionsBitField(rechten),
        // In de kapotte server staat de bot laag, dus Moderator staat erboven.
        roles: { highest: { position: scenario === 'kapot' ? 4 : 9, rawPosition: scenario === 'kapot' ? 4 : 9 } },
      }),
    },
  };
}

/** Een paar regels auditlog, verschillend per scenario. */
function nepAuditlog(scenario: string) {
  const uur = (terug: number) => new Date(Date.now() - terug * 60 * 60 * 1000);
  const wie = (naam: string) => ({ globalName: naam, username: naam.toLowerCase() });

  const regels =
    scenario === 'afgeweken'
      ? [
          { action: AuditLogEvent.ChannelDelete, target: null, changes: [{ key: 'name', old: '🖼️│media' }], executor: wie('Jasper'), createdAt: uur(14) },
          { action: AuditLogEvent.ChannelCreate, target: { name: '🎲│memes' }, executor: wie('Lotte'), createdAt: uur(30) },
          { action: AuditLogEvent.RoleUpdate, target: { name: 'Lid' }, executor: wie('Jasper'), createdAt: uur(52) },
        ]
      : [
          { action: AuditLogEvent.ChannelUpdate, target: { name: '🗣️│algemeen' }, executor: wie('Lotte'), createdAt: uur(8) },
          { action: AuditLogEvent.GuildUpdate, target: null, changes: [{ key: 'verification_level', old: 1, new: 2 }], executor: wie('Setup Bot'), createdAt: uur(26) },
        ];

  return new Collection(regels.map((regel, index) => [String(index), regel]));
}

export const DEMO_SERVERS = [
  { id: '1', naam: 'Picknicken Community', leden: 428, scenario: 'klopt' as const },
  { id: '2', naam: 'Gaming Nederland', leden: 1204, scenario: 'afgeweken' as const },
  { id: '3', naam: 'Test Server', leden: 3, scenario: 'leeg' as const },
  { id: '4', naam: 'Kapotte Rechten', leden: 76, scenario: 'kapot' as const },
];

export function demoGuilds() {
  const guilds = new Collection<string, ReturnType<typeof demoServer>>();
  for (const server of DEMO_SERVERS) guilds.set(server.id, demoServer(server));
  return guilds;
}

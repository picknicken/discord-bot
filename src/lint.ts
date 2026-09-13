import { hidesFromEveryone } from './applier.js';
import { needsCommunity } from './planner.js';
import { channelsNobodySees, simulate } from './simulate.js';
import type { CategorySpec, ChannelSpec, ServerTemplate } from './types.js';

/**
 * Ziet @everyone dit kanaal staan? Een kanaal met eigen rechten erft niets meer
 * van zijn categorie, precies zoals Discord het doet.
 */
function verstoptVoorIedereen(channel: ChannelSpec, category: CategorySpec | null): boolean {
  if (channel.overwrites.length > 0) return hidesFromEveryone(channel.overwrites);
  return category ? hidesFromEveryone(category.overwrites) : false;
}

/** Mag @everyone hier berichten sturen? Dezelfde overerving als hierboven. */
function magIedereenPraten(channel: ChannelSpec, category: CategorySpec | null): boolean {
  const geldend = channel.overwrites.length > 0 ? channel.overwrites : (category?.overwrites ?? []);
  const iedereen = geldend.find((overwrite) => overwrite.role === '@everyone');
  return !iedereen || !iedereen.deny.includes('SendMessages');
}

/**
 * Controles die een template niet ongeldig maken, maar wel problemen opleveren
 * zodra je hem uitrolt: Discord-limieten, dingen die niemand kan zien, en rechten
 * die je waarschijnlijk niet bedoeld hebt.
 */

export type Severity = 'error' | 'warning' | 'info';

export interface Finding {
  severity: Severity;
  where: string;
  message: string;
}

/** Harde limieten van Discord. */
const LIMITS = {
  channels: 500,
  channelsPerCategory: 50,
  roles: 250,
  emojis: 50,
  forumTags: 20,
  automodPerTrigger: { keyword: 6, keyword_preset: 1, spam: 1, mention_spam: 1 },
} as const;

const RISKY_FOR_EVERYONE = [
  'Administrator',
  'ManageGuild',
  'ManageRoles',
  'ManageChannels',
  'BanMembers',
  'KickMembers',
  'ManageWebhooks',
  'MentionEveryone',
];

/** Wat er gecontroleerd is, zodat een schoon rapport ook iets zegt. */
export interface AuditSummary {
  roles: number;
  categories: number;
  channels: number;
  overwrites: number;
  automod: number;
  emojis: number;
  messages: number;
}

export function auditSummary(template: ServerTemplate): AuditSummary {
  const channels = [
    ...template.categories.flatMap((category) => category.channels),
    ...template.uncategorizedChannels,
  ];

  return {
    roles: template.roles.length,
    categories: template.categories.length,
    channels: channels.length,
    overwrites:
      template.categories.reduce((sum, category) => sum + category.overwrites.length, 0) +
      channels.reduce((sum, channel) => sum + channel.overwrites.length, 0),
    automod: template.automod.length,
    emojis: template.emojis.length,
    messages: channels.reduce((sum, channel) => sum + channel.messages.length, 0),
  };
}

export function lintTemplate(template: ServerTemplate): Finding[] {
  const findings: Finding[] = [];
  const add = (severity: Severity, where: string, message: string) => findings.push({ severity, where, message });

  const allChannels = [
    ...template.categories.flatMap((category) => category.channels.map((channel) => ({ category, channel }))),
    ...template.uncategorizedChannels.map((channel) => ({ category: null, channel })),
  ];

  // --- Limieten -----------------------------------------------------------
  const channelTotal = allChannels.length + template.categories.length;
  if (channelTotal > LIMITS.channels) {
    add('error', 'template', `${channelTotal} kanalen en categorieen; Discord staat er ${LIMITS.channels} toe.`);
  }
  if (template.roles.length > LIMITS.roles) {
    add('error', 'template', `${template.roles.length} rollen; Discord staat er ${LIMITS.roles} toe.`);
  }
  if (template.emojis.length > LIMITS.emojis) {
    add('warning', 'emojis', `${template.emojis.length} emoji's; een server zonder boosts heeft ${LIMITS.emojis} plekken.`);
  }
  for (const category of template.categories) {
    if (category.channels.length > LIMITS.channelsPerCategory) {
      add('error', `categorie ${category.name}`, `${category.channels.length} kanalen; het maximum is ${LIMITS.channelsPerCategory}.`);
    }
  }

  const perTrigger = new Map<string, number>();
  for (const rule of template.automod) {
    perTrigger.set(rule.trigger, (perTrigger.get(rule.trigger) ?? 0) + 1);
  }
  for (const [trigger, count] of perTrigger) {
    const max = LIMITS.automodPerTrigger[trigger as keyof typeof LIMITS.automodPerTrigger];
    if (count > max) {
      add('error', 'automod', `${count} regels met trigger "${trigger}"; Discord staat er ${max} toe.`);
    }
  }

  // --- Dubbelingen --------------------------------------------------------
  const duplicates = (values: string[]) =>
    [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];

  for (const name of duplicates(template.roles.map((role) => role.name.toLowerCase()))) {
    add('warning', 'rollen', `twee rollen heten "${name}"; de planner kan ze niet uit elkaar houden.`);
  }
  for (const name of duplicates(template.categories.map((category) => category.name.toLowerCase()))) {
    add('warning', 'categorieen', `twee categorieen heten "${name}".`);
  }
  for (const category of template.categories) {
    for (const name of duplicates(category.channels.map((channel) => channel.name.toLowerCase()))) {
      add('error', `categorie ${category.name}`, `twee kanalen heten "${name}".`);
    }
  }

  // --- Zichtbaarheid ------------------------------------------------------
  for (const name of channelsNobodySees(template)) {
    add('warning', `kanaal ${name}`, 'geen enkele rol kan dit kanaal zien.');
  }

  // --- Overwrites die de categorie overrulen ------------------------------
  // Een kanaal met eigen overwrites erft niets meer van zijn categorie. Wie daar
  // een uitzondering toevoegt, verliest ongemerkt de beperkingen van de categorie.
  for (const category of template.categories) {
    for (const channel of category.channels) {
      if (channel.overwrites.length === 0) continue;

      for (const inherited of category.overwrites) {
        const own = channel.overwrites.find((overwrite) => overwrite.role === inherited.role);
        const lost = inherited.deny.filter(
          (permission) => !own?.deny.includes(permission) && !own?.allow.includes(permission),
        );
        if (lost.length > 0) {
          add(
            'warning',
            `kanaal ${channel.name}`,
            `eigen overwrites vervangen die van categorie "${category.name}"; ` +
              `${inherited.role} verliest daardoor de beperking ${lost.join(', ')}.`,
          );
        }
      }
    }
  }

  // --- Rechten ------------------------------------------------------------
  for (const category of template.categories) {
    const everyone = category.overwrites.find((overwrite) => overwrite.role === '@everyone');
    const risky = (everyone?.allow ?? []).filter((permission) => RISKY_FOR_EVERYONE.includes(permission));
    if (risky.length > 0) {
      add('warning', `categorie ${category.name}`, `@everyone krijgt hier ${risky.join(', ')}.`);
    }
  }

  for (const role of template.roles) {
    if (role.permissions.includes('Administrator') && role.permissions.length > 1) {
      add('info', `rol ${role.name}`, 'Administrator maakt alle andere rechten in deze rol overbodig.');
    }
  }

  const usedInOverwrites = new Set(
    [
      ...template.categories.flatMap((category) => category.overwrites.map((overwrite) => overwrite.role)),
      ...allChannels.flatMap(({ channel }) => channel.overwrites.map((overwrite) => overwrite.role)),
      ...(template.onboarding?.prompts.flatMap((prompt) => prompt.options.flatMap((option) => option.roles)) ?? []),
      ...template.automod.flatMap((rule) => rule.exemptRoles),
      ...template.emojis.flatMap((emoji) => emoji.roles),
    ].filter(Boolean),
  );

  for (const role of template.roles) {
    if (role.permissions.length === 0 && !usedInOverwrites.has(role.key)) {
      add('info', `rol ${role.name}`, 'heeft geen rechten en wordt nergens gebruikt.');
    }
  }

  // --- Namen en typen -----------------------------------------------------
  for (const { channel } of allChannels) {
    if (channel.type === 'text' || channel.type === 'forum' || channel.type === 'announcement') {
      if (/[A-Z\s]/.test(channel.name)) {
        add('info', `kanaal ${channel.name}`, 'Discord maakt hier kleine letters met streepjes van.');
      }
    }
    if (channel.type === 'forum' && channel.tags.length > LIMITS.forumTags) {
      add('error', `kanaal ${channel.name}`, `${channel.tags.length} tags; het maximum is ${LIMITS.forumTags}.`);
    }
  }

  // --- Kanaaltypes die een Community-server vereisen -----------------------
  const communityTypes = [...new Set(
    allChannels.filter(({ channel }) => needsCommunity(channel.type)).map(({ channel }) => channel.type),
  )];

  if (communityTypes.length > 0 && !template.guild.community) {
    add(
      'error',
      'template',
      `${communityTypes.join('- en ')}kanalen bestaan alleen op een Community-server. ` +
        'Zet guild.community aan, met een rulesChannel en updatesChannel erbij.',
    );
  }

  // --- AutoMod -------------------------------------------------------------
  for (const rule of template.automod) {
    if (rule.action === 'timeout' && rule.timeoutSeconds === undefined) {
      add('info', `automod "${rule.name}"`, 'geen time-outduur opgegeven; Discord gebruikt dan 5 minuten.');
    }

    const kort = rule.keywords.filter((keyword) => keyword.replace(/\*/g, '').length < 3);
    if (kort.length > 0) {
      add(
        'warning',
        `automod "${rule.name}"`,
        `korte woorden (${kort.join(', ')}) raken ook stukken van gewone woorden.`,
      );
    }

    if (rule.exemptRoles.length === 0 && rule.action !== 'alert') {
      add('info', `automod "${rule.name}"`, 'geen rol uitgezonderd; ook je eigen staf loopt hiertegenaan.');
    }

    // Een meldkanaal toont de tegengehouden berichten; dat hoort niet openbaar te zijn.
    if (rule.alertChannel) {
      const zichtbaar = simulate(template, '@everyone')
        .categories.flatMap((category) => category.channels)
        .find((channel) => channel.name === rule.alertChannel);

      if (zichtbaar?.visible) {
        add(
          'warning',
          `automod "${rule.name}"`,
          `meldingen gaan naar "${rule.alertChannel}", en dat kanaal kan iedereen zien. ` +
            'Tegengehouden berichten komen daar dus alsnog in beeld.',
        );
      }
    }
  }

  // --- Serverinstellingen --------------------------------------------------
  if (!template.guild.systemChannel) {
    add('info', 'guild', 'geen systeemkanaal; Discord zet welkomstberichten dan nergens neer.');
  }

  // --- Onboarding en community -------------------------------------------
  if (template.onboarding?.enabled) {
    if (template.onboarding.defaultChannels.length < 7) {
      add(
        'warning',
        'onboarding',
        `${template.onboarding.defaultChannels.length} standaardkanalen; Discord wil er meestal minstens 7 voor het aanzetten van onboarding.`,
      );
    }
    if (template.onboarding.prompts.length === 0 && template.onboarding.mode === 'advanced') {
      add('warning', 'onboarding', 'modus "advanced" zonder vragen heeft geen effect.');
    }

    // Discord weigert onboarding als nieuwe leden de standaardkanalen niet zien,
    // of als er minder dan vijf zijn waar ze mogen praten.
    let magPraten = 0;

    for (const naam of template.onboarding.defaultChannels) {
      const gevonden = allChannels.find(({ channel }) => channel.name === naam);
      if (!gevonden) continue;

      if (verstoptVoorIedereen(gevonden.channel, gevonden.category)) {
        add(
          'error',
          'onboarding',
          `standaardkanaal ${naam} is verstopt voor @everyone; een nieuw lid ziet het dus niet en Discord weigert onboarding.`,
        );
      } else if (magIedereenPraten(gevonden.channel, gevonden.category)) {
        magPraten += 1;
      }
    }

    if (template.onboarding.enabled && magPraten < 5) {
      add(
        'warning',
        'onboarding',
        `in ${magPraten} standaardkanalen mag @everyone praten; Discord wil er minstens 5 voor het aanzetten van onboarding.`,
      );
    }
  }

  if (template.guild.community) {
    if (template.guild.explicitContentFilter && template.guild.explicitContentFilter !== 'all_members') {
      add('info', 'guild', 'community-modus dwingt het inhoudsfilter op alle leden; de instelling hier wordt overruled.');
    }
    if (template.guild.verificationLevel === 'none') {
      add('info', 'guild', 'community-modus vereist minstens verificatieniveau laag.');
    }

    // Het regels- en updateskanaal moeten er al zijn voordat community aangaat,
    // en juist de kanaaltypes die community vereisen kunnen dan nog niet bestaan.
    for (const [veld, naam] of [
      ['rulesChannel', template.guild.rulesChannel],
      ['updatesChannel', template.guild.updatesChannel],
    ] as const) {
      if (!naam) continue;
      const gevonden = allChannels.find(({ channel }) => channel.name === naam)?.channel;
      if (!gevonden) continue;

      if (needsCommunity(gevonden.type)) {
        add(
          'error',
          'guild',
          `${veld} wijst naar ${naam}, een ${gevonden.type}kanaal. Dat bestaat pas als community-modus aanstaat, ` +
            'en community-modus gaat pas aan als dit kanaal er is. Kies een gewoon tekstkanaal.',
        );
      } else if (gevonden.type !== 'text') {
        add(
          'error',
          'guild',
          `${veld} wijst naar ${naam}, een ${gevonden.type}kanaal. Discord accepteert hier alleen een tekstkanaal.`,
        );
      }
    }

    const regels = template.guild.rulesChannel
      ? allChannels.find(({ channel }) => channel.name === template.guild.rulesChannel)
      : undefined;

    if (regels && verstoptVoorIedereen(regels.channel, regels.category)) {
      add(
        'warning',
        'guild',
        `het regelskanaal ${regels.channel.name} is verstopt voor @everyone; nieuwe leden moeten de regels juist kunnen lezen.`,
      );
    }
  }

  // Wat deze template van de bot vraagt. Niet fout, wel goed om te weten: zonder
  // Administrator slaat de bot deze onderdelen over in plaats van te stoppen.
  const vraagtAdmin: string[] = [];
  if (template.guild.community) vraagtAdmin.push('community-modus');
  for (const role of template.roles) {
    if (role.permissions.includes('Administrator')) vraagtAdmin.push(`rol @${role.name}`);
  }

  if (vraagtAdmin.length > 0) {
    add(
      'info',
      'template',
      `${vraagtAdmin.join(' en ')} ${vraagtAdmin.length === 1 ? 'vraagt' : 'vragen'} een bot met Administrator. ` +
        'Zonder dat richt hij de rest gewoon in en meldt hij wat er is overgeslagen.',
    );
  }

  if (template.guild.banner) {
    add('info', 'guild', 'een banner werkt pas vanaf boostniveau 2; zonder boosts negeert Discord dit.');
  }

  return findings;
}

export function countBySeverity(findings: Finding[]): Record<Severity, number> {
  return {
    error: findings.filter((finding) => finding.severity === 'error').length,
    warning: findings.filter((finding) => finding.severity === 'warning').length,
    info: findings.filter((finding) => finding.severity === 'info').length,
  };
}

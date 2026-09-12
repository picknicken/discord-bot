import { PermissionFlagsBits } from 'discord.js';

/**
 * Alle permissies die Discord kent, gegroepeerd zoals in de Discord-instellingen,
 * zodat het dashboard er vinkjes van kan maken.
 */

export type PermissionGroup = 'Algemeen' | 'Tekst' | 'Spraak' | 'Overig';

export interface PermissionInfo {
  name: string;
  /** "ManageChannels" -> "Manage Channels" */
  label: string;
  group: PermissionGroup;
  /** Standaard zichtbaar in de overwrite-matrix. */
  common: boolean;
  /** Wat het in gewone woorden betekent. */
  uitleg?: string;
}

/** Kort en in de taal van de gebruiker, niet die van de API. */
const UITLEG: Record<string, string> = {
  ViewChannel: 'Mag het kanaal zien staan. Zonder dit bestaat het voor deze rol niet.',
  SendMessages: 'Mag berichten sturen.',
  SendMessagesInThreads: 'Mag reageren in een draadje.',
  CreatePublicThreads: 'Mag een draadje beginnen dat iedereen ziet.',
  CreatePrivateThreads: 'Mag een besloten draadje beginnen.',
  ManageThreads: 'Mag draadjes hernoemen, sluiten en verwijderen.',
  ManageMessages: 'Mag berichten van anderen verwijderen en vastpinnen.',
  EmbedLinks: 'Links krijgen een voorbeeldweergave.',
  AttachFiles: 'Mag bestanden en afbeeldingen sturen.',
  ReadMessageHistory: 'Ziet wat er eerder gestuurd is. Zonder dit begint het kanaal leeg.',
  MentionEveryone: 'Mag @everyone en @here gebruiken.',
  AddReactions: 'Mag emoji onder berichten zetten.',
  UseExternalEmojis: 'Mag emoji van andere servers gebruiken.',
  UseApplicationCommands: 'Mag slash commands van bots gebruiken.',
  SendTTSMessages: 'Mag berichten laten voorlezen.',
  SendVoiceMessages: 'Mag spraakberichten sturen.',
  SendPolls: 'Mag polls plaatsen.',
  Connect: 'Mag het spraakkanaal binnenkomen.',
  Speak: 'Mag praten in spraak. Zonder dit kun je wel luisteren.',
  Stream: 'Mag scherm delen en video aanzetten.',
  UseVAD: 'Mag spreken zonder drukknop.',
  PrioritySpeaker: 'Overstemt anderen als deze rol praat.',
  MuteMembers: 'Mag anderen dempen in spraak.',
  DeafenMembers: 'Mag anderen het geluid afnemen.',
  MoveMembers: 'Mag anderen naar een ander spraakkanaal slepen.',
  RequestToSpeak: 'Mag op een podium om het woord vragen.',
  UseEmbeddedActivities: 'Mag spelletjes en activiteiten starten in spraak.',
  UseSoundboard: 'Mag geluidjes afspelen in spraak.',
  ManageChannels: 'Mag kanalen aanmaken, aanpassen en verwijderen.',
  ManageRoles: 'Mag rollen en rechten aanpassen, tot aan de eigen rol.',
  ManageGuild: 'Mag serverinstellingen aanpassen.',
  CreateInstantInvite: 'Mag uitnodigingslinks maken.',
  ChangeNickname: 'Mag de eigen bijnaam aanpassen.',
  ManageNicknames: 'Mag bijnamen van anderen aanpassen.',
  KickMembers: 'Mag leden uit de server zetten. Ze kunnen terugkomen.',
  BanMembers: 'Mag leden verbannen. Ze kunnen niet terugkomen.',
  ModerateMembers: 'Mag leden een time-out geven.',
  ViewAuditLog: 'Mag zien wie wat heeft gewijzigd.',
  ViewGuildInsights: 'Mag de groeicijfers van de server bekijken.',
  ManageWebhooks: 'Mag koppelingen met andere diensten beheren.',
  ManageEvents: 'Mag serverevenementen aanpassen.',
  CreateEvents: 'Mag serverevenementen aanmaken.',
  ManageGuildExpressions: 'Mag emoji en stickers beheren.',
  CreateGuildExpressions: 'Mag emoji en stickers toevoegen.',
  Administrator: 'Mag alles, en negeert alle uitzonderingen per kanaal. Wees hier zuinig mee.',
  SetVoiceChannelStatus: 'Mag de status van een spraakkanaal zetten.',
  UseExternalStickers: 'Mag stickers van andere servers gebruiken.',
  UseExternalSounds: 'Mag geluidjes van andere servers gebruiken.',
  BypassSlowmode: 'Heeft geen last van de wachttijd tussen berichten.',
  ManageEmojisAndStickers: 'Mag emoji en stickers beheren.',
  PinMessages: 'Mag berichten vastpinnen.',
  UseExternalApps: 'Mag apps van buiten deze server gebruiken.',
  ViewCreatorMonetizationAnalytics: 'Mag de verdiencijfers van de server bekijken.',
};

const GROUPS: Record<Exclude<PermissionGroup, 'Overig'>, readonly string[]> = {
  Algemeen: [
    'ViewChannel', 'ManageChannels', 'ManageRoles', 'ManageGuild', 'CreateInstantInvite',
    'ChangeNickname', 'ManageNicknames', 'KickMembers', 'BanMembers', 'ModerateMembers',
    'ViewAuditLog', 'ViewGuildInsights', 'ManageWebhooks', 'ManageEvents', 'CreateEvents',
    'ManageGuildExpressions', 'CreateGuildExpressions', 'Administrator',
  ],
  Tekst: [
    'SendMessages', 'SendMessagesInThreads', 'CreatePublicThreads', 'CreatePrivateThreads',
    'ManageThreads', 'ManageMessages', 'EmbedLinks', 'AttachFiles', 'ReadMessageHistory',
    'MentionEveryone', 'AddReactions', 'UseExternalEmojis', 'UseExternalStickers',
    'UseApplicationCommands', 'SendTTSMessages', 'SendVoiceMessages', 'SendPolls',
  ],
  Spraak: [
    'Connect', 'Speak', 'Stream', 'UseVAD', 'PrioritySpeaker', 'MuteMembers', 'DeafenMembers',
    'MoveMembers', 'RequestToSpeak', 'UseEmbeddedActivities', 'UseSoundboard',
    'UseExternalSounds', 'SetVoiceChannelStatus',
  ],
};

/** Wat je in de praktijk per kanaal zet; de rest staat achter "alles tonen". */
const COMMON = new Set([
  'ViewChannel', 'SendMessages', 'ReadMessageHistory', 'AddReactions', 'AttachFiles', 'EmbedLinks',
  'ManageMessages', 'MentionEveryone', 'CreatePublicThreads', 'SendMessagesInThreads',
  'UseApplicationCommands', 'Connect', 'Speak', 'Stream',
]);

function groupOf(name: string): PermissionGroup {
  for (const [group, names] of Object.entries(GROUPS) as [PermissionGroup, readonly string[]][]) {
    if (names.includes(name)) return group;
  }
  return 'Overig';
}

const ORDER: PermissionGroup[] = ['Algemeen', 'Tekst', 'Spraak', 'Overig'];

export const PERMISSION_CATALOGUE: PermissionInfo[] = Object.keys(PermissionFlagsBits)
  .map((name) => ({
    name,
    label: name.replace(/([a-z])([A-Z])/g, '$1 $2'),
    group: groupOf(name),
    common: COMMON.has(name),
    uitleg: UITLEG[name],
  }))
  .sort((a, b) => {
    const byGroup = ORDER.indexOf(a.group) - ORDER.indexOf(b.group);
    if (byGroup !== 0) return byGroup;
    const list = GROUPS[a.group as Exclude<PermissionGroup, 'Overig'>] ?? [];
    const byOrder = list.indexOf(a.name) - list.indexOf(b.name);
    return byOrder !== 0 ? byOrder : a.name.localeCompare(b.name);
  });

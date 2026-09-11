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
}

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
  }))
  .sort((a, b) => {
    const byGroup = ORDER.indexOf(a.group) - ORDER.indexOf(b.group);
    if (byGroup !== 0) return byGroup;
    const list = GROUPS[a.group as Exclude<PermissionGroup, 'Overig'>] ?? [];
    const byOrder = list.indexOf(a.name) - list.indexOf(b.name);
    return byOrder !== 0 ? byOrder : a.name.localeCompare(b.name);
  });

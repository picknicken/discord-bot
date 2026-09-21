import type { SnapshotAutomod, SnapshotSettings } from '../../src/snapshot.js';

/**
 * Serverinstellingen zoals Discord ze op een verse server zet.
 *
 * De planner vergelijkt de template hiermee, dus een momentopname in een test
 * heeft ze nodig - anders valt er niets te vergelijken.
 */
export const standaardInstellingen: SnapshotSettings = {
  verificationLevel: 'none',
  explicitContentFilter: 'disabled',
  defaultMessageNotifications: 'all_messages',
  systemChannelId: null,
  afkChannelId: null,
  rulesChannelId: null,
  updatesChannelId: null,
  afkTimeoutSeconds: 300,
  description: null,
  community: false,
};

/** Een AutoMod-regel in de momentopname; vul alleen aan wat de test aangaat. */
export function snapshotAutomod(id: string, name: string, extra: Partial<SnapshotAutomod> = {}): SnapshotAutomod {
  return {
    id,
    name,
    enabled: true,
    trigger: 'spam',
    keywords: [],
    regexPatterns: [],
    allowList: [],
    presets: [],
    mentionLimit: null,
    acties: [{ soort: 'block', customMessage: null, timeoutSeconds: null, channelId: null }],
    exemptRoleIds: [],
    ...extra,
  };
}

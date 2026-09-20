import {
  AutoModerationActionType,
  AutoModerationRuleKeywordPresetType,
  AutoModerationRuleTriggerType,
  type AutoModerationRule,
} from 'discord.js';
import { describe, expect, it } from 'vitest';
import { automodUitServer } from '../src/exporter.js';

/**
 * Een server exporteren gaf een template zonder AutoMod-regels — zonder dat
 * iets dat zei. Je denkt een kopie te hebben en mist stilletjes een stuk.
 */
const rolKeys = new Map([['r1', 'moderator']]);
const kanaalNaam = (id: string | null) => (id === 'c9' ? '🛡│logboek' : undefined);

/** Zoveel van een discord.js-regel als deze omzetting aanraakt. */
const regel = (extra: Record<string, unknown>) =>
  ({
    name: 'Grof taalgebruik',
    enabled: true,
    exemptRoles: [{ id: 'r1' }],
    triggerMetadata: {},
    actions: [],
    ...extra,
  }) as unknown as AutoModerationRule;

describe('AutoMod terug naar een template', () => {
  it('neemt een woordfilter mee, inclusief uitzonderingen', () => {
    const spec = automodUitServer(
      regel({
        triggerType: AutoModerationRuleTriggerType.Keyword,
        triggerMetadata: { keywordFilter: ['sukkel'], regexPatterns: ['\\bhufter\\b'], allowList: ['sukkeldraf'] },
        actions: [{ type: AutoModerationActionType.BlockMessage, metadata: { customMessage: 'Niet doen.' } }],
      }),
      rolKeys,
      kanaalNaam,
    );

    expect(spec).toMatchObject({
      name: 'Grof taalgebruik',
      trigger: 'keyword',
      keywords: ['sukkel'],
      regexPatterns: ['\\bhufter\\b'],
      allowList: ['sukkeldraf'],
      action: 'block',
      customMessage: 'Niet doen.',
      exemptRoles: ['moderator'],
      enabled: true,
    });
  });

  it('vertaalt de presets terug naar leesbare namen', () => {
    const spec = automodUitServer(
      regel({
        triggerType: AutoModerationRuleTriggerType.KeywordPreset,
        triggerMetadata: { presets: [AutoModerationRuleKeywordPresetType.Profanity, AutoModerationRuleKeywordPresetType.Slurs] },
        actions: [{ type: AutoModerationActionType.BlockMessage, metadata: {} }],
      }),
      rolKeys,
      kanaalNaam,
    );

    expect(spec.trigger).toBe('keyword_preset');
    expect(spec.presets).toEqual(['profanity', 'slurs']);
  });

  it('zet een melding om naar de kanaalnaam, niet het id', () => {
    const spec = automodUitServer(
      regel({
        triggerType: AutoModerationRuleTriggerType.Spam,
        actions: [{ type: AutoModerationActionType.SendAlertMessage, metadata: { channelId: 'c9' } }],
      }),
      rolKeys,
      kanaalNaam,
    );

    expect(spec.action).toBe('alert');
    expect(spec.alertChannel).toBe('🛡│logboek');
  });

  it('houdt de time-outduur vast', () => {
    const spec = automodUitServer(
      regel({
        triggerType: AutoModerationRuleTriggerType.MentionSpam,
        triggerMetadata: { mentionTotalLimit: 7 },
        actions: [{ type: AutoModerationActionType.Timeout, metadata: { durationSeconds: 600 } }],
      }),
      rolKeys,
      kanaalNaam,
    );

    expect(spec).toMatchObject({ trigger: 'mention_spam', mentionLimit: 7, action: 'timeout', timeoutSeconds: 600 });
  });
});

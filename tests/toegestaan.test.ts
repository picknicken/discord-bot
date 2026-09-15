import { describe, expect, it } from 'vitest';
import { leesToegestaneServers, serverToegestaan, uitlegNietToegestaan } from '../src/toegestaan.js';

describe('lijst met toegestane servers', () => {
  it('laat zonder lijst alles toe', () => {
    expect(serverToegestaan('123', [])).toBe(true);
  });

  it('laat alleen de servers uit de lijst toe zodra die gevuld is', () => {
    expect(serverToegestaan('123', ['123', '456'])).toBe(true);
    expect(serverToegestaan('456', ['123', '456'])).toBe(true);
    expect(serverToegestaan('999', ['123', '456'])).toBe(false);
  });

  it('trekt zich niets aan van spaties rond het ingetypte id', () => {
    expect(serverToegestaan(' 123 ', ['123'])).toBe(true);
  });

  it('leest de lijst met komma\'s, spaties of regels ertussen', () => {
    expect(leesToegestaneServers('123,456')).toEqual(['123', '456']);
    expect(leesToegestaneServers(' 123 , 456 ')).toEqual(['123', '456']);
    expect(leesToegestaneServers('123\n456')).toEqual(['123', '456']);
    expect(leesToegestaneServers('')).toEqual([]);
    expect(leesToegestaneServers(undefined)).toEqual([]);
  });

  it('vertelt waar je de lijst aanpast', () => {
    const uitleg = uitlegNietToegestaan('999', ['123']);
    expect(uitleg).toContain('999');
    expect(uitleg).toContain('123');
    expect(uitleg).toContain('GUILD_IDS');
    expect(uitleg).toContain('niets veranderd');
  });
});

import { describe, expect, it } from 'vitest';
import {
  buildAuthorizeUrl,
  buildGuildInviteUrl,
  isAllowed,
  readSessionCookie,
  sessionCookie,
  SessionStore,
} from '../src/auth.js';

const user = { id: '42', username: 'schaap', globalName: null, avatarUrl: 'https://example.invalid/a.png' };

describe('sessies', () => {
  it('maakt een sessie met een onraadbare id', () => {
    const store = new SessionStore();
    const session = store.create(user, []);

    expect(session.id).toMatch(/^[0-9a-f]{64}$/);
    expect(store.get(session.id)?.user.username).toBe('schaap');
  });

  it('kent een onbekende of ontbrekende id niet', () => {
    const store = new SessionStore();
    expect(store.get(undefined)).toBeNull();
    expect(store.get('nep')).toBeNull();
  });

  it('vergeet een verlopen sessie', () => {
    const store = new SessionStore();
    const session = store.create(user, []);
    session.expiresAt = Date.now() - 1;
    expect(store.get(session.id)).toBeNull();
  });

  it('laat uitloggen de sessie vernietigen', () => {
    const store = new SessionStore();
    const session = store.create(user, []);
    store.destroy(session.id);
    expect(store.get(session.id)).toBeNull();
  });

  it('accepteert een state maar een keer', () => {
    const store = new SessionStore();
    const state = store.issueState();

    expect(store.consumeState(state)).toBe(true);
    expect(store.consumeState(state)).toBe(false);
    expect(store.consumeState('verzonnen')).toBe(false);
    expect(store.consumeState(null)).toBe(false);
  });
});

describe('cookies', () => {
  it('leest de sessie uit een cookieheader', () => {
    expect(readSessionCookie('thema=dark; setupbot_session=abc123; x=1')).toBe('abc123');
    expect(readSessionCookie('thema=dark')).toBeUndefined();
    expect(readSessionCookie(undefined)).toBeUndefined();
  });

  it('zet het cookie buiten bereik van scripts', () => {
    const cookie = sessionCookie('abc', false);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).not.toContain('Secure');
    expect(sessionCookie('abc', true)).toContain('Secure');
  });
});

describe('toegang', () => {
  it('laat zonder lijst alleen de eigenaar van de applicatie binnen', () => {
    expect(isAllowed('42', [], '42')).toBe(true);
    expect(isAllowed('99', [], '42')).toBe(false);
    expect(isAllowed('42', [], null)).toBe(false);
  });

  it('gebruikt de lijst zodra die gevuld is', () => {
    expect(isAllowed('99', ['99', '100'], '42')).toBe(true);
    expect(isAllowed('42', ['99'], '42')).toBe(false);
  });
});

describe('links', () => {
  it('vraagt alleen identiteit en serverlijst', () => {
    const url = new URL(buildAuthorizeUrl('123', 'http://127.0.0.1:4000/auth/callback', 'xyz'));
    expect(url.searchParams.get('scope')).toBe('identify guilds');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('xyz');
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:4000/auth/callback');
  });

  it('zet de server vast in een invite-link', () => {
    const url = new URL(buildGuildInviteUrl('123', '268553264', '999'));
    expect(url.searchParams.get('guild_id')).toBe('999');
    expect(url.searchParams.get('disable_guild_select')).toBe('true');
    expect(url.searchParams.get('permissions')).toBe('268553264');
  });
});

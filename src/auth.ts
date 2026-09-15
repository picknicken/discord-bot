import { randomBytes } from 'node:crypto';

/**
 * Inloggen met Discord. Het dashboard handelt namens de bot, dus het moet weten
 * wie er aan de knoppen zit. OAuth2 levert twee dingen: een bewijs van identiteit
 * (zodat alleen jij erbij kunt) en de lijst servers waar jij beheerder bent.
 *
 * De sessie-id is zelf het geheim: 32 willekeurige bytes, alleen serverkant bekend.
 * Bij een herstart zijn alle sessies weg — dan log je opnieuw in.
 */

const DISCORD_API = 'https://discord.com/api/v10';
const SESSION_COOKIE = 'setupbot_session';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const STATE_MS = 10 * 60 * 1000;

export interface DiscordUser {
  id: string;
  username: string;
  globalName: string | null;
  avatarUrl: string;
}

export interface OAuthGuild {
  id: string;
  name: string;
  iconUrl: string | null;
  owner: boolean;
  /** Mag deze gebruiker de server beheren? Zonder dit recht kan hij de bot niet toevoegen. */
  canManage: boolean;
}

export interface Session {
  id: string;
  user: DiscordUser;
  guilds: OAuthGuild[];
  expiresAt: number;
}

const MANAGE_GUILD = 1n << 5n;

export class SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly states = new Map<string, number>();

  create(user: DiscordUser, guilds: OAuthGuild[]): Session {
    this.sweep();
    const session: Session = {
      id: randomBytes(32).toString('hex'),
      user,
      guilds,
      expiresAt: Date.now() + SESSION_MS,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string | undefined): Session | null {
    if (!id) return null;
    const session = this.sessions.get(id);
    if (!session) return null;
    if (session.expiresAt < Date.now()) {
      this.sessions.delete(id);
      return null;
    }
    return session;
  }

  destroy(id: string | undefined): void {
    if (id) this.sessions.delete(id);
  }

  /** Eenmalige waarde tegen CSRF op de callback. */
  issueState(): string {
    this.sweep();
    const state = randomBytes(16).toString('hex');
    this.states.set(state, Date.now() + STATE_MS);
    return state;
  }

  consumeState(state: string | null): boolean {
    if (!state) return false;
    const expires = this.states.get(state);
    this.states.delete(state);
    return expires !== undefined && expires > Date.now();
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) if (session.expiresAt < now) this.sessions.delete(id);
    for (const [state, expires] of this.states) if (expires < now) this.states.delete(state);
  }
}

export function buildAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify guilds',
    state,
    prompt: 'none',
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

/** Invite-link met deze server al ingevuld, zodat er alleen nog op Toevoegen geklikt hoeft. */
export function buildGuildInviteUrl(clientId: string, permissions: string, guildId: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    scope: 'bot applications.commands',
    permissions,
    guild_id: guildId,
    disable_guild_select: 'true',
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

export function readSessionCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return rest.join('=');
  }
  return undefined;
}

export function sessionCookie(id: string, secure: boolean): string {
  return [
    `${SESSION_COOKIE}=${id}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_MS / 1000)}`,
    secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

export const clearedCookie = `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;

/** Wisselt de code uit voor een token en haalt daarmee de gebruiker en zijn servers op. */
export async function exchangeCode(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  code: string,
): Promise<{ user: DiscordUser; guilds: OAuthGuild[] }> {
  const tokenResponse = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenResponse.ok) {
    throw new Error(`Discord weigerde de inlogcode (${tokenResponse.status}). Klopt de redirect-URL in het portal?`);
  }

  const { access_token: accessToken } = (await tokenResponse.json()) as { access_token: string };
  const authorized = { headers: { authorization: `Bearer ${accessToken}` } };

  const [userResponse, guildResponse] = await Promise.all([
    fetch(`${DISCORD_API}/users/@me`, authorized),
    fetch(`${DISCORD_API}/users/@me/guilds`, authorized),
  ]);

  if (!userResponse.ok) throw new Error('Kon je Discord-profiel niet ophalen.');

  const profile = (await userResponse.json()) as {
    id: string;
    username: string;
    global_name: string | null;
    avatar: string | null;
    discriminator: string;
  };

  const guilds = guildResponse.ok
    ? ((await guildResponse.json()) as { id: string; name: string; icon: string | null; owner: boolean; permissions: string }[])
    : [];

  return {
    user: {
      id: profile.id,
      username: profile.username,
      globalName: profile.global_name,
      avatarUrl: profile.avatar
        ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png?size=64`
        : `https://cdn.discordapp.com/embed/avatars/${(Number(profile.discriminator) || 0) % 5}.png`,
    },
    guilds: guilds.map((guild) => ({
      id: guild.id,
      name: guild.name,
      iconUrl: guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=64` : null,
      owner: guild.owner,
      canManage: guild.owner || (BigInt(guild.permissions) & MANAGE_GUILD) === MANAGE_GUILD,
    })),
  };
}

/**
 * Mag deze gebruiker iets met deze server?
 *
 * Alleen servers waar hij zelf serverbeheerder is. Dat de bot ergens in zit
 * zegt niets over wie er mag meekijken of ingrijpen: zonder deze controle kan
 * iedereen die mag inloggen elke server van iedereen leeghalen.
 *
 * Zonder ingelogde sessie draait het dashboard op de eigen computer, met
 * inloggen uit. Dan is er niemand om te onderscheiden en mag alles.
 */
export function magBeheren(session: Session | null, guildId: string): boolean {
  if (!session) return true;
  return session.guilds.some((guild) => guild.id === guildId && guild.canManage);
}

/** Wie mag er binnen: de opgegeven lijst, anders alleen de eigenaar van de applicatie. */
export function isAllowed(userId: string, owners: readonly string[], applicationOwnerId: string | null): boolean {
  if (owners.length > 0) return owners.includes(userId);
  return applicationOwnerId !== null && userId === applicationOwnerId;
}

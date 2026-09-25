import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { PermissionFlagsBits, PermissionsBitField, type Guild } from 'discord.js';
import {
  AvatarFout,
  bewaarAvatar,
  leesAvatar,
  pasIdentiteitToe,
  synchroniseerIdentiteiten,
  verwijderAvatar,
  waaromGeenBijnaam,
} from '../src/botIdentiteit.js';
import { zetServerInstellingen } from '../src/serverInstellingen.js';

// Een piepklein maar geldig PNG'tje (1x1 transparant), zodat een echte
// data-URL door de validatie komt.
const PNG_1X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function nepServer(rechten = PermissionFlagsBits.ChangeNickname, nickname: string | null = null, avatar: string | null = null) {
  const editMe = vi.fn(async () => undefined);
  const guild = {
    id: 'g1',
    name: 'Testserver',
    members: {
      me: { permissions: new PermissionsBitField(rechten), nickname, avatar },
      editMe,
    },
  } as unknown as Guild;
  return { guild, editMe };
}

describe('avatarbestanden bewaren', () => {
  it('weigert een ongeldige data-URL', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'identiteit-'));
    await expect(bewaarAvatar(dir, 'g1', 'niet-een-data-url')).rejects.toBeInstanceOf(AvatarFout);
  });

  it('weigert een te grote afbeelding', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'identiteit-'));
    const groot = 'data:image/png;base64,' + Buffer.alloc(1_100_000, 1).toString('base64');
    await expect(bewaarAvatar(dir, 'g1', groot)).rejects.toThrow(/te groot/);
  });

  it('bewaart en leest een geldig plaatje terug, en ruimt een oude extensie op', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'identiteit-'));
    await bewaarAvatar(dir, 'g1', PNG_1X1);

    const gelezen = await leesAvatar(dir, 'g1');
    expect(gelezen?.mime).toBe('image/png');
    expect(gelezen?.buffer.length).toBeGreaterThan(0);

    // Nog een keer opslaan mag het vorige bestand niet laten liggen.
    await bewaarAvatar(dir, 'g1', PNG_1X1);
    const map = path.join(dir, 'bot-avatars');
    const bestanden = await import('node:fs/promises').then((fs) => fs.readdir(map));
    expect(bestanden.filter((naam) => naam.startsWith('g1.'))).toHaveLength(1);

    await verwijderAvatar(dir, 'g1');
    expect(await leesAvatar(dir, 'g1')).toBeNull();
  });

  it('geeft null voor een server zonder eigen plaatje', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'identiteit-'));
    expect(await leesAvatar(dir, 'onbekend')).toBeNull();
  });
});

describe('identiteit toepassen in Discord', () => {
  it('zet de bijnaam alleen als hij anders is', async () => {
    const { guild, editMe } = nepServer(PermissionFlagsBits.ChangeNickname, 'Oude naam');
    await pasIdentiteitToe(guild, { naam: 'Oude naam', avatar: null });
    expect(editMe).not.toHaveBeenCalled();

    await pasIdentiteitToe(guild, { naam: 'Nieuwe naam', avatar: null });
    expect(editMe).toHaveBeenCalledWith({ nick: 'Nieuwe naam', reason: expect.any(String) });
  });

  it('zet geen bijnaam zonder het recht, maar wel het plaatje', async () => {
    const { guild, editMe } = nepServer(0n, 'Oude naam');
    const buffer = Buffer.from('plaatje');
    await pasIdentiteitToe(guild, { naam: 'Nieuwe naam', avatar: { buffer } });

    expect(editMe).toHaveBeenCalledWith({ avatar: buffer, reason: expect.any(String) });
  });

  it('haalt het eigen plaatje weg als er geen gewenst plaatje meer is', async () => {
    const { guild, editMe } = nepServer(PermissionFlagsBits.ChangeNickname, null, 'ietsvaneenhash');
    await pasIdentiteitToe(guild, { naam: null, avatar: null });
    expect(editMe).toHaveBeenCalledWith({ avatar: null, reason: expect.any(String) });
  });

  it('doet niets als naam en plaatje al kloppen', async () => {
    const { guild, editMe } = nepServer(PermissionFlagsBits.ChangeNickname, 'Naam', null);
    await pasIdentiteitToe(guild, { naam: 'Naam', avatar: null });
    expect(editMe).not.toHaveBeenCalled();
  });

  it('zegt waarom de bijnaam niet kan', () => {
    const { guild } = nepServer(0n);
    expect(waaromGeenBijnaam(guild)).toMatch(/Eigen bijnaam wijzigen/);
  });
});

describe('bij het opstarten', () => {
  it('laat servers zonder eigen instelling met rust', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'identiteit-'));
    const { guild, editMe } = nepServer();
    const client = { guilds: { cache: new Map([['g1', guild]]) } } as never;

    await synchroniseerIdentiteiten(client, dir);
    expect(editMe).not.toHaveBeenCalled();
  });

  it('past een eerder opgeslagen naam opnieuw toe', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'identiteit-'));
    await zetServerInstellingen(dir, 'g1', { botNaam: 'Clanbot' });
    const { guild, editMe } = nepServer(PermissionFlagsBits.ChangeNickname, 'Oude naam');
    const client = { guilds: { cache: new Map([['g1', guild]]) } } as never;

    await synchroniseerIdentiteiten(client, dir);
    expect(editMe).toHaveBeenCalledWith({ nick: 'Clanbot', reason: expect.any(String) });
  });
});

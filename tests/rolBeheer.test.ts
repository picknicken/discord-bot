import { describe, expect, it, vi } from 'vitest';
import { Collection, PermissionFlagsBits, PermissionsBitField, type Guild } from 'discord.js';
import { beschrijfRollen, maakRol, RolFout, valideer, verwijderRol, wijzigRol } from '../src/rolBeheer.js';

/**
 * Rollen rechtstreeks aanpassen. De vraag is vooral of hij vooraf weigert wat
 * Discord straks toch weigert - met een reden die je begrijpt.
 */
function nepServer(botRechten = PermissionFlagsBits.ManageRoles | PermissionFlagsBits.KickMembers) {
  const rol = (id: string, name: string, position: number, extra: Record<string, unknown> = {}) => ({
    id,
    name,
    color: 0,
    hoist: false,
    mentionable: false,
    permissions: new PermissionsBitField(0n),
    position,
    managed: false,
    edit: vi.fn(async function (this: unknown) {
      return this;
    }),
    delete: vi.fn(async () => undefined),
    ...extra,
  });

  const roles = new Collection<string, ReturnType<typeof rol>>([
    ['g', rol('g', '@everyone', 0)],
    ['lid', rol('lid', 'Lid', 1, { color: 0x57f287, permissions: new PermissionsBitField(PermissionFlagsBits.BanMembers) })],
    ['bot', rol('bot', 'Setup Bot', 5)],
    ['baas', rol('baas', 'Baas', 7)],
    ['app', rol('app', 'Andere bot', 2, { managed: true })],
  ]);

  const guild = {
    id: 'g',
    roles: {
      cache: roles,
      create: vi.fn(async (velden: { name: string }) => {
        const nieuw = rol('nieuw', velden.name, 1);
        roles.set('nieuw', nieuw);
        return nieuw;
      }),
    },
    members: {
      fetchMe: async () => ({
        permissions: new PermissionsBitField(botRechten),
        roles: { highest: { position: 5 } },
      }),
    },
  } as unknown as Guild;

  return { guild, roles };
}

describe('rollen rechtstreeks aanpassen', () => {
  it('zegt per rol of de bot eraan mag komen', async () => {
    const { guild } = nepServer();
    const { rollen } = await beschrijfRollen(guild);
    const vast = Object.fromEntries(rollen.map((rol) => [rol.name, rol.vast]));

    expect(rollen[0]?.name).toBe('Baas');
    expect(vast.Lid).toBeNull();
    expect(vast['@everyone']).toBeNull();
    expect(vast.Baas).toMatch(/boven/);
    expect(vast['Setup Bot']).toMatch(/boven/);
    expect(vast['Andere bot']).toMatch(/integratie/);
    expect(rollen.find((rol) => rol.name === 'Lid')).toMatchObject({ color: '#57f287', permissions: ['BanMembers'] });
  });

  it('stuurt de wijziging door naar Discord', async () => {
    const { guild, roles } = nepServer();
    await wijzigRol(guild, 'lid', { name: ' Leden ', color: '#ff0000', permissions: ['BanMembers', 'KickMembers'] }, 'Jasper');

    expect(roles.get('lid')?.edit).toHaveBeenCalledWith({
      name: 'Leden',
      color: 0xff0000,
      permissions: PermissionFlagsBits.BanMembers | PermissionFlagsBits.KickMembers,
      reason: 'Dashboard: door Jasper',
    });
  });

  it('weigert een rol boven de bot of van een integratie', async () => {
    const { guild, roles } = nepServer();
    await expect(wijzigRol(guild, 'baas', { hoist: true }, 'x')).rejects.toMatchObject({ status: 403 });
    await expect(verwijderRol(guild, 'app', 'x')).rejects.toBeInstanceOf(RolFout);
    expect(roles.get('baas')?.edit).not.toHaveBeenCalled();
  });

  it('geeft geen rechten die de bot zelf niet heeft, maar laat bestaande staan', async () => {
    const { guild } = nepServer();
    // BanMembers stond er al op; dat mag blijven zonder dat de bot het heeft.
    await expect(wijzigRol(guild, 'lid', { permissions: ['BanMembers'] }, 'x')).resolves.toBeTruthy();
    await expect(wijzigRol(guild, 'lid', { permissions: ['Administrator'] }, 'x')).rejects.toThrow(
      /Ontbreekt: Administrator/,
    );
  });

  it('weigert rare invoer', () => {
    const me = { permissions: new PermissionsBitField(PermissionFlagsBits.Administrator) } as never;
    expect(() => valideer({ name: '' }, me)).toThrow(/1 tot 100/);
    expect(() => valideer({ color: 'rood' }, me)).toThrow(/Ongeldige kleur/);
    expect(() => valideer({ permissions: ['Vliegen'] }, me)).toThrow(/Onbekende rechten: Vliegen/);
    expect(() => valideer({ name: 'x' }, me, { everyone: true })).toThrow(/@everyone/);
    expect(valideer({ color: null }, me)).toEqual({ color: 0 });
  });

  it('maakt een nieuwe rol en verwijdert @everyone nooit', async () => {
    const { guild } = nepServer();
    const rol = await maakRol(guild, { name: 'Helper' }, 'x');
    expect(rol).toMatchObject({ name: 'Helper', vast: null });
    await expect(verwijderRol(guild, 'g', 'x')).rejects.toThrow(/@everyone/);
  });

  it('doet niets zonder het recht Rollen beheren', async () => {
    const { guild } = nepServer(0n);
    await expect(wijzigRol(guild, 'lid', { hoist: true }, 'x')).rejects.toThrow(/Rollen beheren/);
    await expect(maakRol(guild, { name: 'x' }, 'x')).rejects.toThrow(/Rollen beheren/);
  });
});

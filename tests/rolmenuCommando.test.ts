import { describe, expect, it } from 'vitest';

process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = '123456789';
process.env.GUILD_IDS = '987654321';

const { execute, verwerkRollenVeld, vindRol } = await import('../src/commands/rolmenu.js');

describe('rollen-veld uit elkaar halen', () => {
  it('herkent naam, emoji en label', () => {
    const uitkomst = verwerkRollenVeld('nl', 'Gamer:🎮:Speelt spelletjes, Muziek');
    expect(uitkomst).toEqual({
      entries: [
        { rolTekst: 'Gamer', emoji: '🎮', label: 'Speelt spelletjes' },
        { rolTekst: 'Muziek', emoji: null, label: null },
      ],
    });
  });

  it('weigert een lege lijst', () => {
    expect(verwerkRollenVeld('nl', '  ,  ')).toEqual({ fout: expect.stringMatching(/minstens één/) });
  });

  it('weigert meer dan 25 rollen', () => {
    const veel = Array.from({ length: 26 }, (_, i) => `rol${i}`).join(',');
    expect(verwerkRollenVeld('nl', veel)).toEqual({ fout: expect.stringMatching(/maximaal 25/) });
  });
});

function nepGuild(rollen: { id: string; name: string; position?: number; managed?: boolean }[]) {
  const cache = new Map(rollen.map((rol) => [rol.id, { position: 1, managed: false, ...rol }]));
  return {
    roles: {
      cache: {
        get: (id: string) => cache.get(id),
        find: (fn: (rol: unknown) => boolean) => [...cache.values()].find(fn),
      },
    },
    // Boven de standaard rolpositie (1), zodat een rol pas "boven mijn eigen
    // rol" is als een test dat er expliciet bij zet.
    members: { me: { roles: { highest: { position: 50 } }, permissions: { has: () => true } } },
  };
}

describe('een rol vinden', () => {
  it('vindt op naam, ongeacht hoofdletters', () => {
    const guild = nepGuild([{ id: '1', name: 'Gamer' }]);
    expect(vindRol(guild as never, 'gamer')?.id).toBe('1');
  });

  it('vindt op mention', () => {
    const guild = nepGuild([{ id: '42', name: 'Gamer' }]);
    expect(vindRol(guild as never, '<@&42>')?.id).toBe('42');
  });

  it('geeft null als de rol niet bestaat', () => {
    const guild = nepGuild([{ id: '1', name: 'Gamer' }]);
    expect(vindRol(guild as never, 'Onbekend')).toBeNull();
  });
});

/** Een minimale nepinteractie: alleen wat execute() ervan gebruikt. */
function stubInteractie(opties: {
  titel?: string;
  rollen?: string;
  beschrijving?: string;
  stijl?: string;
  kleur?: string;
  heeftManageRoles?: boolean;
  volledigeKanaalRechten?: boolean;
  rollenInServer?: { id: string; name: string; position?: number; managed?: boolean }[];
}) {
  const antwoorden: unknown[] = [];
  const verstuurd: unknown[] = [];

  const guild = nepGuild(opties.rollenInServer ?? [{ id: '1', name: 'Gamer' }]);

  const waarden: Record<string, string | undefined> = {
    titel: opties.titel ?? 'Kies je rol',
    rollen: opties.rollen ?? 'Gamer',
    beschrijving: opties.beschrijving,
    stijl: opties.stijl,
    kleur: opties.kleur,
  };

  return {
    antwoorden,
    verstuurd,
    interactie: {
      locale: 'nl',
      guildId: '987654321',
      inGuild: () => true,
      guild,
      memberPermissions: { has: () => opties.heeftManageRoles ?? true },
      channel: {
        isTextBased: () => true,
        toString: () => '#algemeen',
        permissionsFor: () => ({ has: () => opties.volledigeKanaalRechten ?? true }),
        send: async (bericht: unknown) => {
          verstuurd.push(bericht);
        },
      },
      options: {
        getString: (naam: string, verplicht?: boolean) => {
          const waarde = waarden[naam] ?? null;
          if (verplicht && waarde === null) throw new Error(`ontbrekende optie ${naam}`);
          return waarde;
        },
        getChannel: () => null,
      },
      reply: async (bericht: unknown) => {
        antwoorden.push(bericht);
      },
    },
  };
}

describe('/rolmenu', () => {
  it('plaatst een rolmenu met de gekozen rollen', async () => {
    const { interactie, antwoorden, verstuurd } = stubInteractie({
      rollen: 'Gamer:🎮, Muziek:🎵:Muziek liefhebber',
      rollenInServer: [
        { id: '1', name: 'Gamer' },
        { id: '2', name: 'Muziek' },
      ],
    });

    await execute(interactie as never);

    expect(verstuurd).toHaveLength(1);
    expect(antwoorden).toHaveLength(1);
    expect((antwoorden[0] as { content: string }).content).toMatch(/2 rol/);
  });

  it('werkt alleen in een server', async () => {
    const { interactie, antwoorden } = stubInteractie({});
    interactie.inGuild = () => false;

    await execute(interactie as never);

    expect((antwoorden[0] as { content: string }).content).toMatch(/alleen in een server/);
  });

  it('weigert zonder het recht "Rollen beheren"', async () => {
    const { interactie, antwoorden, verstuurd } = stubInteractie({ heeftManageRoles: false });

    await execute(interactie as never);

    expect(verstuurd).toHaveLength(0);
    expect((antwoorden[0] as { content: string }).content).toMatch(/Rollen beheren/);
  });

  it('weigert een onbekende rol', async () => {
    const { interactie, antwoorden } = stubInteractie({ rollen: 'Onbekend' });

    await execute(interactie as never);

    expect((antwoorden[0] as { content: string }).content).toMatch(/is geen rol/);
  });

  it('weigert dezelfde rol twee keer', async () => {
    const { interactie, antwoorden } = stubInteractie({ rollen: 'Gamer, gamer' });

    await execute(interactie as never);

    expect((antwoorden[0] as { content: string }).content).toMatch(/staat er twee keer in/);
  });

  it('weigert een rol boven de eigen rol van de bot', async () => {
    const { interactie, antwoorden } = stubInteractie({
      rollenInServer: [{ id: '1', name: 'Gamer', position: 100 }],
    });

    await execute(interactie as never);

    expect((antwoorden[0] as { content: string }).content).toMatch(/boven mijn eigen rol/);
  });

  it('weigert een ongeldige hexkleur', async () => {
    const { interactie, antwoorden } = stubInteractie({ kleur: 'nietprima' });

    await execute(interactie as never);

    expect((antwoorden[0] as { content: string }).content).toMatch(/geldige hexkleur/);
  });

  it('weigert zonder rechten van de bot in dat kanaal', async () => {
    const { interactie, antwoorden, verstuurd } = stubInteractie({ volledigeKanaalRechten: false });

    await execute(interactie as never);

    expect(verstuurd).toHaveLength(0);
    expect((antwoorden[0] as { content: string }).content).toMatch(/mag niet praten in/);
  });
});

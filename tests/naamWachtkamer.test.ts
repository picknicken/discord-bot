import { afterAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Message } from 'discord.js';
import { verwerkNaamBericht } from '../src/clan/verificatie.js';
import { zetInstellingen } from '../src/clan/opslag.js';
import { parseClanInstellingen } from '../src/clan/rangen.js';

/**
 * De verplichte naamkoppeling: een bericht in het welkomkanaal telt als
 * koppelpoging voor wie de wachtkamerrol nog heeft. Zonder WOM-clans erbij
 * (dossier.instellingen.clans blijft leeg) zegt koppelEnMeld gewoon "geen
 * clan ingesteld" — dat is genoeg om de rest van deze flow te toetsen zonder
 * het WiseOldMan-netwerk na te bootsen.
 */
const werkmap = mkdtempSync(path.join(tmpdir(), 'wachtkamer-'));
afterAll(() => rmSync(werkmap, { recursive: true, force: true }));

function nepBericht(opties: {
  content: string;
  heeftWachtkamerrol: boolean;
  bot?: boolean;
}) {
  const remove = vi.fn(async () => undefined);
  const reply = vi.fn(async () => undefined);
  const rollen = new Set(opties.heeftWachtkamerrol ? ['wacht1'] : []);

  const member = {
    id: 'lid1',
    user: { username: 'Nieuwelid' },
    roles: { cache: { has: (id: string) => rollen.has(id) }, remove },
  };

  const message = {
    author: { id: 'lid1', bot: opties.bot ?? false },
    content: opties.content,
    channelId: 'kanaal1',
    guildId: '101',
    guild: { id: '101', name: 'Testserver', preferredLocale: 'nl' },
    member,
    inGuild: () => true,
    reply,
  } as unknown as Message<true>;

  return { message, remove, reply };
}

describe('naam typen in de wachtkamer', () => {
  it('koppelt en haalt de wachtkamerrol eraf', async () => {
    await zetInstellingen(
      werkmap,
      '101',
      parseClanInstellingen({ verplicht: true, wachtkamerRol: 'wacht1', welkomKanaal: 'kanaal1' }),
    );
    const { message, remove, reply } = nepBericht({ content: 'Sparc Mac', heeftWachtkamerrol: true });

    await verwerkNaamBericht(message, werkmap);

    expect(remove).toHaveBeenCalledWith('wacht1', expect.any(String));
    expect(reply).toHaveBeenCalled();
  });

  it('laat een bot met rust', async () => {
    await zetInstellingen(
      werkmap,
      '102',
      parseClanInstellingen({ verplicht: true, wachtkamerRol: 'wacht1', welkomKanaal: 'kanaal1' }),
    );
    const { message, remove } = nepBericht({ content: 'Sparc Mac', heeftWachtkamerrol: true, bot: true });
    message.guildId = '102';

    await verwerkNaamBericht(message, werkmap);
    expect(remove).not.toHaveBeenCalled();
  });

  it('doet niets in een ander kanaal dan het welkomkanaal', async () => {
    await zetInstellingen(
      werkmap,
      '103',
      parseClanInstellingen({ verplicht: true, wachtkamerRol: 'wacht1', welkomKanaal: 'kanaal1' }),
    );
    const { message, remove } = nepBericht({ content: 'Sparc Mac', heeftWachtkamerrol: true });
    message.guildId = '103';
    message.channelId = 'ander-kanaal';

    await verwerkNaamBericht(message, werkmap);
    expect(remove).not.toHaveBeenCalled();
  });

  it('doet niets zonder de wachtkamerrol — dat is gewoon een berichtje', async () => {
    await zetInstellingen(
      werkmap,
      '104',
      parseClanInstellingen({ verplicht: true, wachtkamerRol: 'wacht1', welkomKanaal: 'kanaal1' }),
    );
    const { message, remove, reply } = nepBericht({ content: 'hallo allemaal', heeftWachtkamerrol: false });
    message.guildId = '104';

    await verwerkNaamBericht(message, werkmap);
    expect(remove).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  it('doet niets als de server het niet heeft aangezet', async () => {
    await zetInstellingen(werkmap, '105', parseClanInstellingen({}));
    const { message, remove } = nepBericht({ content: 'Sparc Mac', heeftWachtkamerrol: true });
    message.guildId = '105';

    await verwerkNaamBericht(message, werkmap);
    expect(remove).not.toHaveBeenCalled();
  });

  it('doet niets zonder wachtkamerrol ingesteld, ook al staat verplicht aan', async () => {
    await zetInstellingen(
      werkmap,
      '106',
      parseClanInstellingen({ verplicht: true, welkomKanaal: 'kanaal1' }),
    );
    const { message, remove } = nepBericht({ content: 'Sparc Mac', heeftWachtkamerrol: false });
    message.guildId = '106';

    await verwerkNaamBericht(message, werkmap);
    expect(remove).not.toHaveBeenCalled();
  });
});

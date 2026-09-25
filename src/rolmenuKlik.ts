import {
  MessageFlags,
  PermissionFlagsBits,
  type ButtonInteraction,
  type GuildMember,
  type Role,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { ROLMENU_KNOP } from './rolmenu.js';
import { kiesTaal, t, type Taal } from './taal.js';
import { logger } from './util/logger.js';

/**
 * Wat er gebeurt als iemand op een rolmenu klikt.
 *
 * Het antwoord is altijd ephemeral: alleen hij ziet het. Een kanaal waarin bij
 * elke klik "X heeft nu de rol Y" verschijnt is na een dag onleesbaar, en het is
 * ook niemands zaak.
 *
 * En het zegt waarom iets niet lukt. "Er ging iets mis" stuurt iemand naar een
 * beheerder die het ook niet weet; "die rol staat boven mijn eigen rol" is een
 * probleem dat diezelfde beheerder in tien seconden oplost.
 */

/** De reden waarom de bot deze rol niet kan geven, of null als het gewoon kan. */
export function waaromNiet(
  rol: { position: number; managed: boolean; name: string },
  ik: { hoogstePositie: number; magRollenBeheren: boolean } | null,
  taal: Taal = 'nl',
): string | null {
  if (!ik) return t(taal, 'rolmenu.ikweg');
  if (!ik.magRollenBeheren) return t(taal, 'rolmenu.geenrechten');
  if (rol.managed) return t(taal, 'rolmenu.managed', { rol: rol.name });
  if (rol.position >= ik.hoogstePositie) return t(taal, 'rolmenu.boven', { rol: rol.name });
  return null;
}

/** Wat er bij dit lid bij moet en af moet, na een keuze in het menu. */
export function watVerandert(
  alle: readonly string[],
  gekozen: readonly string[],
  heeft: readonly string[],
): { erbij: string[]; eraf: string[] } {
  const kiest = new Set(gekozen);
  const heeftNu = new Set(heeft);

  return {
    erbij: alle.filter((id) => kiest.has(id) && !heeftNu.has(id)),
    eraf: alle.filter((id) => !kiest.has(id) && heeftNu.has(id)),
  };
}

const noem = (rollen: readonly Role[]): string => rollen.map((rol) => `**${rol.name}**`).join(', ');

async function meld(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  tekst: string,
): Promise<void> {
  await interaction.reply({ content: tekst, flags: MessageFlags.Ephemeral }).catch(() => undefined);
}

export function overMij(member: GuildMember | null) {
  return member
    ? { hoogstePositie: member.roles.highest.position, magRollenBeheren: member.permissions.has(PermissionFlagsBits.ManageRoles) }
    : null;
}

/** Eén knop: de rol erbij als je hem niet hebt, eraf als je hem wel hebt. */
export async function klikRolmenu(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.inCachedGuild()) return;

  // Alleen hij ziet dit antwoord, dus zijn eigen taal.
  const taal = kiesTaal(interaction.locale);
  const roleId = interaction.customId.slice(ROLMENU_KNOP.length);
  const rol = interaction.guild.roles.cache.get(roleId);
  if (!rol) {
    await meld(interaction, t(taal, 'rolmenu.rolweg'));
    return;
  }

  const nee = waaromNiet(rol, overMij(interaction.guild.members.me), taal);
  if (nee) {
    await meld(interaction, nee);
    return;
  }

  const heeft = interaction.member.roles.cache.has(roleId);
  try {
    if (heeft) await interaction.member.roles.remove(rol, 'Rolmenu');
    else await interaction.member.roles.add(rol, 'Rolmenu');
  } catch (error) {
    logger.warn(`Rolmenu: ${rol.name} ${heeft ? 'weghalen' : 'geven'} mislukt`, error);
    await meld(interaction, t(taal, heeft ? 'rolmenu.halenmislukt' : 'rolmenu.gevenmislukt', { rol: rol.name }));
    return;
  }

  await meld(interaction, t(taal, heeft ? 'rolmenu.eraf' : 'rolmenu.erbij', { rol: rol.name }));
}

/**
 * Een keuzemenu: wat aangevinkt staat krijg je, wat je uitvinkt gaat eraf.
 *
 * Welke rollen bij dit menu horen staat in het menu zelf - we lezen ze uit het
 * bericht waarop geklikt is. Daardoor is er geen lijst die bijgehouden moet
 * worden, en kan een oud menu nooit rollen weghalen die er niet meer in staan.
 */
export async function kiesInRolmenu(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!interaction.inCachedGuild()) return;

  const taal = kiesTaal(interaction.locale);
  const alle = interaction.component.options.map((optie) => optie.value);
  const { erbij, eraf } = watVerandert(alle, interaction.values, [...interaction.member.roles.cache.keys()]);

  const rollen = (ids: readonly string[]): Role[] =>
    ids.map((id) => interaction.guild.roles.cache.get(id)).filter((rol): rol is Role => rol !== undefined);

  const teGeven = rollen(erbij);
  const teHalen = rollen(eraf);

  for (const rol of [...teGeven, ...teHalen]) {
    const nee = waaromNiet(rol, overMij(interaction.guild.members.me), taal);
    if (nee) {
      await meld(interaction, nee);
      return;
    }
  }

  try {
    if (teGeven.length > 0) await interaction.member.roles.add(teGeven, 'Rolmenu');
    if (teHalen.length > 0) await interaction.member.roles.remove(teHalen, 'Rolmenu');
  } catch (error) {
    logger.warn('Rolmenu: rollen bijwerken mislukt', error);
    await meld(interaction, t(taal, 'rolmenu.bijwerkenmislukt'));
    return;
  }

  const delen = [
    teGeven.length > 0 ? t(taal, 'rolmenu.waterbij', { rollen: noem(teGeven) }) : '',
    teHalen.length > 0 ? t(taal, 'rolmenu.wateraf', { rollen: noem(teHalen) }) : '',
  ].filter(Boolean);

  await meld(interaction, delen.length > 0 ? `${delen.join(', ')}.` : t(taal, 'rolmenu.niets'));
}

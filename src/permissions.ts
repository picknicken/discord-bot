import { PermissionsBitField } from 'discord.js';

export const PERMISSION_NAMES = Object.keys(PermissionsBitField.Flags) as (keyof typeof PermissionsBitField.Flags)[];

const PERMISSION_SET = new Set<string>(PERMISSION_NAMES);

export function isValidPermission(name: string): boolean {
  return PERMISSION_SET.has(name);
}

/** Zet permissienamen uit een template om naar een bitfield. Onbekende namen worden overgeslagen. */
export function toBitfield(names: readonly string[]): bigint {
  let bits = 0n;
  for (const name of names) {
    if (isValidPermission(name)) {
      bits |= PermissionsBitField.Flags[name as keyof typeof PermissionsBitField.Flags];
    }
  }
  return bits;
}

/** Omgekeerde richting: bitfield -> namen, voor de export van een bestaande server. */
export function toNames(bits: bigint): string[] {
  return new PermissionsBitField(bits).toArray();
}

export function unknownPermissions(names: readonly string[]): string[] {
  return names.filter((name) => !isValidPermission(name));
}

import { describe, expect, it } from 'vitest';
import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import {
  BEPERKTE_PERMISSIONS,
  INVITE_PERMISSIONS,
  INVITE_SCOPES,
  REQUIRED_PERMISSIONS,
  buildInviteUrl,
  permissionLabel,
} from '../src/botPermissions.js';

describe('invite-rechten', () => {
  it('bevat alles wat de bot verplicht nodig heeft', () => {
    for (const permission of REQUIRED_PERMISSIONS) {
      expect(INVITE_PERMISSIONS.has(permission), permissionLabel(permission)).toBe(true);
    }
  });

  it('vraagt Administrator, want anders kan hij zijn werk niet af maken', () => {
    // Discord laat een bot geen recht uitdelen dat hij zelf niet heeft, en
    // community-modus aanzetten kan met niets minder.
    expect(INVITE_PERMISSIONS.has(PermissionFlagsBits.Administrator)).toBe(true);
  });

  it('houdt een beperkte variant voor wie dat niet wil', () => {
    expect(BEPERKTE_PERMISSIONS.has(PermissionFlagsBits.Administrator)).toBe(false);
    for (const permission of REQUIRED_PERMISSIONS) {
      expect(BEPERKTE_PERMISSIONS.has(permission), permissionLabel(permission)).toBe(true);
    }
  });

  it('bouwt op verzoek de beperkte link', () => {
    const url = new URL(buildInviteUrl('123456789', { beperkt: true }));
    expect(url.searchParams.get('permissions')).toBe(BEPERKTE_PERMISSIONS.bitfield.toString());
  });

  it('bouwt een invite-link met scopes en permissiebits', () => {
    const url = new URL(buildInviteUrl('123456789'));
    expect(url.origin + url.pathname).toBe('https://discord.com/oauth2/authorize');
    expect(url.searchParams.get('client_id')).toBe('123456789');
    expect(url.searchParams.get('scope')?.split(' ')).toEqual([...INVITE_SCOPES]);

    const permissions = url.searchParams.get('permissions');
    expect(permissions).toBe(INVITE_PERMISSIONS.bitfield.toString());
    expect(new PermissionsBitField(BigInt(permissions!)).has(PermissionFlagsBits.ManageRoles)).toBe(true);
  });

  it('geeft leesbare namen bij permissiebits', () => {
    expect(permissionLabel(PermissionFlagsBits.ManageGuild)).toBe('ManageGuild');
  });
});

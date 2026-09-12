import { config } from './config.js';
import { BEPERKTE_PERMISSIONS, buildInviteUrl, INVITE_PERMISSIONS } from './botPermissions.js';

/**
 * De invite-link, met uitleg waarom hij om Administrator vraagt. Dat is geen
 * gemakzucht: Discord laat een bot geen recht uitdelen dat hij zelf niet heeft,
 * dus een template met een beheerdersrol vraagt een bot met Administrator. En
 * community-modus aanzetten kan met niets minder.
 */

console.log(buildInviteUrl(config.clientId));
console.log(`\nRechten (${INVITE_PERMISSIONS.bitfield}):`);
for (const permission of INVITE_PERMISSIONS.toArray()) console.log(`  - ${permission}`);

console.log('\nLiever zonder Administrator? Dan kan de bot geen community-modus aanzetten');
console.log('en geen rollen aanmaken met rechten die hij zelf niet heeft:');
console.log(buildInviteUrl(config.clientId, { beperkt: true }));
console.log(`\nRechten (${BEPERKTE_PERMISSIONS.bitfield}):`);
for (const permission of BEPERKTE_PERMISSIONS.toArray()) console.log(`  - ${permission}`);

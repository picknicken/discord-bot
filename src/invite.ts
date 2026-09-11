import { config } from './config.js';
import { buildInviteUrl, INVITE_PERMISSIONS } from './botPermissions.js';

console.log(buildInviteUrl(config.clientId));
console.log(`\nRechten (${INVITE_PERMISSIONS.bitfield}):`);
for (const permission of INVITE_PERMISSIONS.toArray()) console.log(`  - ${permission}`);

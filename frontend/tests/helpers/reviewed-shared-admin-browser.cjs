const assert=require('node:assert/strict');
const authImport="import { openNotificationsAfterOutage, captureSharedAdmin } from './support/shared-admin-browser.mjs';\n";
function once(source,old,replacement=''){assert.equal(source.split(old).length,2);return source.replace(old,replacement);}
function normalizeAuth(source){source=once(source,authImport);source=once(source,'  await openNotificationsAfterOutage(page);',"  await page.goto('/dashboard/notifications');");return once(source,"\n  await captureSharedAdmin(page, info, 'notifications-loaded');");}
function normalizeAdministration(source){source=once(source,"import { verifyActivityReadOwnership, verifyPersonalUnknown } from './support/shared-admin-browser.mjs';\n\n");source=once(source,'\n  await verifyActivityReadOwnership(page, info);');return once(source,'\n  await verifyPersonalUnknown(page, info);');}
module.exports={normalizeAuth,normalizeAdministration};

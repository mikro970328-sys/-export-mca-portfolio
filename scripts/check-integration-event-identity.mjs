import assert from 'node:assert/strict';
import { whatsappDeliveryKey, whatsappMilestoneAllowed } from '../api/_notification-delivery.js';

assert.equal(whatsappDeliveryKey('DEPA'),'tracking:DEPA');
assert.equal(whatsappDeliveryKey('depa'),'tracking:DEPA');
assert.equal(whatsappDeliveryKey('RELEASE'),'tracking:RELEASE');
assert.equal(whatsappDeliveryKey('release'),'tracking:RELEASE');

for (const blocked of ['LOAD','ARRV','DISC','GTOT','DELIVERED','REGISTERED','UNKNOWN','']) {
  assert.equal(whatsappDeliveryKey(blocked),null,`${blocked || 'empty'} must not have a WhatsApp delivery key`);
  assert.equal(whatsappMilestoneAllowed(blocked),false,`${blocked || 'empty'} must not be WhatsApp-enabled`);
}
assert.equal(whatsappMilestoneAllowed('DEPA'),true);
assert.equal(whatsappMilestoneAllowed('RELEASE'),true);

console.log('P19 WhatsApp milestone identity gate passed: only DEPA and RELEASE are shipment notifications.');

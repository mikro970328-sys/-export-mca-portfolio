import assert from 'node:assert/strict';
import { providerEventKey, trackingDeliveryKey } from '../api/_integration-events.js';

const base={
  provider:'shipsgo',
  trackingId:'track-1',
  container:'MSCU1234567',
  eventCode:'DEPA',
  eventTime:'2026-08-31T01:00:00.000Z',
  location:'Miami',
  status:'Salió del puerto'
};

const first=providerEventKey(base);
const second=providerEventKey({...base});
assert.equal(first,second,'same provider event must have stable identity');
assert.match(first,/^[a-f0-9]{64}$/,'provider event identity must be sha256 hex');
assert.notEqual(first,providerEventKey({...base,eventTime:'2026-08-31T01:01:00.000Z'}),'event time must version provider identity');
assert.notEqual(first,providerEventKey({...base,location:'Mariel'}),'location must version provider identity');
assert.notEqual(first,providerEventKey({...base,status:'Llegó al puerto'}),'status must version provider identity');
assert.equal(trackingDeliveryKey('DEPA'),'tracking:DEPA');
assert.equal(trackingDeliveryKey('delivered'),'tracking:DELIVERED');
assert.equal(trackingDeliveryKey('unknown'),null);

console.log('P18 provider event identity gate passed.');

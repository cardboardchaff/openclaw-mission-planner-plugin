import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadStore,
  openTicket,
  recordTicketNote,
  setTicketStatus,
  setDeliveryState,
} from '../lib/tickets.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcr-tickets-'));
const stateDir = path.join(tmp, 'state');

const ticket = openTicket(stateDir, {
  sessionKey: 's1',
  objective: 'obj',
  classification: 'deterministic-host-op',
  scope: 'scope',
  successMeasure: 'measure',
  expectedDurationSeconds: 10,
  hardTimeoutSeconds: 20,
  deliveryRequired: true,
});

recordTicketNote(stateDir, ticket.ticketId, 'initial note');
setTicketStatus(stateDir, ticket.ticketId, 'waiting', 'waiting on dependency');
setDeliveryState(stateDir, ticket.ticketId, 'in_progress', 'delivery started');

assert.throws(() => {
  setTicketStatus(stateDir, ticket.ticketId, 'waithing', 'typo');
}, /invalid status/);

assert.throws(() => {
  setDeliveryState(stateDir, ticket.ticketId, 'progessing', 'typo');
}, /invalid deliveryState/);

const filePath = path.join(stateDir, 'mission-control-runtime', 'tickets.json');
fs.writeFileSync(filePath, '{ not-json ', 'utf8');
const recovered = loadStore(stateDir);
assert.equal(Array.isArray(recovered.tickets), true);
assert.equal(recovered.tickets.length, 0);

const siblingFiles = fs.readdirSync(path.dirname(filePath));
assert.equal(siblingFiles.some((name) => name.includes('.corrupt-')), true);

console.log(JSON.stringify({ ok: true }, null, 2));

import assert from 'node:assert/strict';
import { normalizeToolName, resolvePluginPolicy, toolRequiresTicket } from '../lib/policy.js';

const policy = resolvePluginPolicy();

assert.equal(normalizeToolName('sessions.spawn'), 'sessions_spawn');
assert.equal(normalizeToolName('host_exec'), 'exec');
assert.equal(toolRequiresTicket('sessions.spawn', {}, policy), true);
assert.equal(toolRequiresTicket('host_exec', { cmd: 'echo ok' }, policy), false);
assert.equal(toolRequiresTicket('host_exec', { cmd: 'openclaw gateway restart' }, policy), true);
assert.equal(toolRequiresTicket('command_exec', { detach: true, cmd: 'echo hi' }, policy), true);
assert.equal(toolRequiresTicket('exec', { interactiveTty: true, command: 'echo hi' }, policy), true);
assert.equal(toolRequiresTicket('exec', { timeoutMs: 120000, command: 'echo hi' }, policy), true);

console.log(JSON.stringify({ ok: true }, null, 2));

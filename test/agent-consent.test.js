'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { AgentConsentStore, isSystemChangingAction } = require(path.join(__dirname, '..', 'src', 'agent', 'consent.js'));

let passed = 0;
assert.equal(isSystemChangingAction('INSTALL_SOP sop_id="chrome"'), true);
assert.equal(isSystemChangingAction('EXECUTE_TASK task_id="task_1"'), true);
assert.equal(isSystemChangingAction('CLEAR_ALL'), true);
assert.equal(isSystemChangingAction('CREATE_WINGET_SOP package_id="x"'), true);
assert.equal(isSystemChangingAction('OPEN_FILE file_path="x"'), true);
assert.equal(isSystemChangingAction('BROWSER_USE mode="search"'), false);
passed++;

const store = new AgentConsentStore({ ttlMs: 1000 });
const pending = store.create('INSTALL_SOP sop_id="chrome"', { sessionId: 'chat-1' });
assert.ok(pending.id.length >= 32);
assert.equal(pending.action, 'install_sop');
assert.equal(pending.sopId, 'chrome');
assert.equal(store.consume('missing', 'chat-1'), null);
passed++;

assert.equal(store.consume(pending.id, 'chat-2'), null);
assert.equal(store.consume(pending.id, 'chat-1').actionString, 'INSTALL_SOP sop_id="chrome"');
assert.equal(store.consume(pending.id, 'chat-1'), null);
passed++;

const expiredStore = new AgentConsentStore({ ttlMs: 0 });
const expired = expiredStore.create('CLEAR_ALL', { sessionId: 'chat-1' });
assert.equal(expiredStore.consume(expired.id, 'chat-1'), null);
passed++;

console.log(`\n[agent-consent.test] ${passed} passed`);

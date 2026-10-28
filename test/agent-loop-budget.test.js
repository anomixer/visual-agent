'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { AgentLoopBudget } = require(path.join(__dirname, '..', 'src', 'agent', 'loop-budget.js'));

let passed = 0;
let now = 1000;
const budget = new AgentLoopBudget({ maxTurns: 2, deadlineMs: 500, now: () => now });
assert.equal(budget.startTurn(), true);
assert.equal(budget.startTurn(), true);
assert.equal(budget.startTurn(), false);
now += 501;
assert.equal(budget.remainingMs(), 0);
assert.equal(budget.canStartTurn(), false);
passed++;

const toolBudget = new AgentLoopBudget({
    maxToolCalls: 2,
    initialActions: ['BROWSER_USE mode="search" query="weather"'],
});
const first = toolBudget.takeActions([
    'BROWSER_USE mode="search" query="weather"',
    'BROWSER_USE mode="extract_text" url="https://example.com/1"',
    'BROWSER_USE mode="extract_text" url="https://example.com/2"',
]);
assert.deepEqual(first.accepted, ['BROWSER_USE mode="extract_text" url="https://example.com/1"']);
assert.equal(first.duplicates, 1);
assert.equal(first.overflow, 1);
assert.equal(toolBudget.toolCalls, 2);
passed++;

const second = toolBudget.takeActions(['BROWSER_USE mode="extract_text" url="https://example.com/1"']);
assert.deepEqual(second.accepted, []);
assert.equal(second.duplicates, 1);
passed++;

console.log(`\n[agent-loop-budget.test] ${passed} passed`);

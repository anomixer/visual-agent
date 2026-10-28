'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { once } = require('node:events');
const { test } = require('node:test');
const { createChatHarness } = require('./helpers/chat-harness');
const { version: packageVersion } = require('../package.json');

function request(port, method, route, token) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            host: '127.0.0.1', port, path: route, method, agent: false,
            headers: {
                Host: '127.0.0.1:3210',
                ...(token ? { 'X-Visual-Agent-Token': token } : {}),
            },
        }, (res) => {
            let raw = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { raw += chunk; });
            res.on('error', reject);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
                catch { reject(new Error(`Non-JSON ${res.statusCode} from ${route}: ${raw.slice(0, 200)}`)); }
            });
        });
        req.setTimeout(5000, () => req.destroy(new Error(`Timed out: ${route}`)));
        req.on('error', reject);
        req.end();
    });
}

test('task export reports the package version and current tasks', async (t) => {
    const harness = createChatHarness();
    let server;
    t.after(async () => {
        try {
            if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        } finally {
            harness.dispose();
            harness.assertSafe();
        }
    });
    server = harness.app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = server.address().port;

    const meta = await request(port, 'GET', '/api/meta');
    assert.equal(meta.status, 200);
    const token = meta.body.localApiToken;
    assert.ok(token);

    harness.setTasks([{
        id: 'export-fixture-task', title: 'Synthetic export task', skillId: 'export_fixture_sop',
        action: 'install', category: 'Test', status: 'pending', progress: 0, logs: [],
        createdAt: '2026-10-28T12:00:00.000Z',
    }]);

    const response = await request(port, 'GET', '/api/todo/export', token);
    assert.equal(response.status, 200);
    assert.equal(response.body.agentVersion, packageVersion);
    assert.equal(response.body.tasks.length, 1);
    assert.equal(response.body.tasks[0].id, 'export-fixture-task');
    assert.match(response.body.exportedAt, /^\d{4}-\d{2}-\d{2}T/);
});

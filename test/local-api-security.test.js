'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { createLocalApiSecurity } = require(path.join(__dirname, '..', 'src', 'local-api-security.js'));

let passed = 0;

function invoke(security, request = {}) {
    const req = {
        method: 'GET',
        path: '/api/llm/config',
        headers: { host: '127.0.0.1:3210' },
        ...request,
        headers: {
            host: '127.0.0.1:3210',
            ...(request.headers || {}),
        },
    };
    const res = {
        statusCode: 200,
        headers: {},
        body: null,
        setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
        sendStatus(code) { this.statusCode = code; return this; },
        end() { return this; },
    };
    let nextCalled = false;
    security.middleware(req, res, () => { nextCalled = true; });
    return { req, res, nextCalled };
}

const security = createLocalApiSecurity({ token: 'test-token' });

let result = invoke(security, { path: '/api/meta' });
assert.equal(result.nextCalled, true);
passed++;

result = invoke(security);
assert.equal(result.res.statusCode, 401);
assert.equal(result.nextCalled, false);
passed++;

result = invoke(security, { headers: { 'x-visual-agent-token': 'wrong' } });
assert.equal(result.res.statusCode, 401);
passed++;

result = invoke(security, { headers: { 'x-visual-agent-token': 'test-token' } });
assert.equal(result.nextCalled, true);
passed++;

result = invoke(security, { headers: { origin: 'https://evil.example', 'x-visual-agent-token': 'test-token' } });
assert.equal(result.res.statusCode, 403);
assert.equal(result.res.headers['access-control-allow-origin'], undefined);
passed++;

result = invoke(security, { headers: { host: 'evil.example' } });
assert.equal(result.res.statusCode, 403);
passed++;

result = invoke(security, { headers: { 'sec-fetch-site': 'cross-site' }, path: '/api/meta' });
assert.equal(result.res.statusCode, 403);
passed++;

result = invoke(security, {
    method: 'OPTIONS',
    headers: { origin: 'https://tauri.localhost' },
});
assert.equal(result.res.statusCode, 204);
assert.equal(result.res.headers['access-control-allow-origin'], 'https://tauri.localhost');
assert.match(result.res.headers['access-control-allow-headers'], /X-Visual-Agent-Token/i);
passed++;

result = invoke(security, {
    headers: { origin: 'http://localhost:3210', 'x-visual-agent-token': 'test-token' },
});
assert.equal(result.nextCalled, true);
assert.equal(result.res.headers['access-control-allow-origin'], 'http://localhost:3210');
passed++;

const generated = createLocalApiSecurity();
assert.ok(generated.token.length >= 43);
assert.notEqual(generated.token, createLocalApiSecurity().token);
passed++;

console.log(`\n[local-api-security.test] ${passed} passed`);

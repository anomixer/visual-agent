'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.join(__dirname, '..');
const packageJson = require(path.join(root, 'package.json'));
const tauriConfig = require(path.join(root, 'src-tauri', 'tauri.conf.json'));

let passed = 0;
assert.equal(tauriConfig.version, packageJson.version);
passed++;

const csp = tauriConfig.app?.security?.csp || '';
assert.equal(typeof csp, 'string');
assert.ok(csp.includes("default-src 'self'"));
assert.ok(csp.includes("script-src 'self' 'unsafe-inline'"));
assert.ok(csp.includes("object-src 'none'"));
assert.ok(csp.includes("base-uri 'none'"));
assert.ok(csp.includes("frame-src 'none'"));
assert.ok(csp.includes('ipc: http://ipc.localhost'));
assert.ok(csp.includes('http://localhost:3210'));
passed++;

for (const asset of ['sops/**/*', 'skills/**/*', 'plugins/**/*', 'public/**/*']) {
    assert.ok(packageJson.pkg?.assets?.includes(asset), `Missing pkg asset: ${asset}`);
}
passed++;

console.log(`\n[release-config.test] ${passed} passed`);

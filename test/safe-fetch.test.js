'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { isDisallowedIp, parsePublicHttpUrl, safeFetchText } = require(path.join(__dirname, '..', 'src', 'safe-fetch.js'));
const { isSystemChangingAction } = require(path.join(__dirname, '..', 'src', 'agent', 'consent.js'));

let passed = 0;
for (const ip of [
    '0.0.0.1', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.169.254',
    '172.16.0.1', '192.168.1.1', '198.18.0.1', '224.0.0.1', '255.255.255.255',
    '::', '::1', 'fc00::1', 'fe80::1', 'ff02::1', '2001:db8::1', '::ffff:127.0.0.1',
]) {
    assert.equal(isDisallowedIp(ip), true, ip);
}
assert.equal(isDisallowedIp('8.8.8.8'), false);
assert.equal(isDisallowedIp('2001:4860:4860::8888'), false);
passed++;

assert.throws(() => parsePublicHttpUrl('file:///C:/Windows/win.ini'));
assert.throws(() => parsePublicHttpUrl('http://user:pass@example.com'));
assert.throws(() => parsePublicHttpUrl('http://127.0.0.1'));
assert.throws(() => parsePublicHttpUrl('http://2130706433'));
assert.throws(() => parsePublicHttpUrl('http://[::1]'));
assert.equal(parsePublicHttpUrl('https://example.com/path').hostname, 'example.com');
passed++;

assert.equal(isSystemChangingAction('BROWSER_USE mode="navigate" url="https://example.com"'), true);
assert.equal(isSystemChangingAction('BROWSER_USE mode="open" url="https://example.com"'), true);
assert.equal(isSystemChangingAction('BROWSER_USE mode="extract_text" url="https://example.com"'), false);
passed++;

(async () => {
    await assert.rejects(() => safeFetchText('http://127.0.0.1:3210/api/llm/config'), /blocked/);
    await assert.rejects(() => safeFetchText('http://169.254.169.254/latest/meta-data'), /blocked/);
    console.log(`\n[safe-fetch.test] ${passed + 1} passed`);
})().catch((error) => {
    console.error(error);
    process.exit(1);
});

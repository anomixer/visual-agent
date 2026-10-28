'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const {
    escapeHtml,
    sanitizeMarkdownHtml,
    normalizeImageDataUrl,
    MAX_IMAGE_DATA_URL_LENGTH,
} = require(path.join(__dirname, '..', 'public', 'ui-security.js'));

let passed = 0;
assert.equal(escapeHtml('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
assert.equal(sanitizeMarkdownHtml('<img src=x onerror=alert(1)>', undefined), '&lt;img src=x onerror=alert(1)&gt;');
assert.equal(sanitizeMarkdownHtml('<b>ok</b>', { sanitize: () => { throw new Error('missing DOM'); } }), '&lt;b&gt;ok&lt;/b&gt;');
assert.equal(sanitizeMarkdownHtml('<b>ok</b>', { sanitize: (html) => html }), '<b>ok</b>');
passed++;

const png = `data:image/png;base64,${Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]).toString('base64')}`;
const jpeg = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]).toString('base64')}`;
assert.equal(normalizeImageDataUrl(png), png);
assert.equal(normalizeImageDataUrl(jpeg), jpeg);
passed++;

assert.equal(normalizeImageDataUrl('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='), '');
assert.equal(normalizeImageDataUrl('data:image/png;base64,PHN2Zz48L3N2Zz4='), '');
assert.equal(normalizeImageDataUrl('data:image/png;base64,AAAA'), '');
assert.equal(normalizeImageDataUrl('https://example.com/a.png'), '');
assert.equal(normalizeImageDataUrl('data:image/png;base64,AAAA\" onerror=\"alert(1)'), '');
assert.equal(normalizeImageDataUrl(`data:image/png;base64,${'A'.repeat(MAX_IMAGE_DATA_URL_LENGTH)}`), '');
passed++;

console.log(`\n[ui-security.test] ${passed} passed`);

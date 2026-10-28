'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const sourcePath = path.join(__dirname, '..', 'public', 'app.js');
const source = fs.readFileSync(sourcePath, 'utf8');

function readBlock(startIndex) {
    let depth = 0;
    for (let i = startIndex; i < source.length; i++) {
        const char = source[i];
        if (char === '{') depth++;
        else if (char === '}') {
            depth--;
            if (depth === 0) return source.slice(startIndex, i + 1);
        }
    }
    throw new Error('Unbalanced block while reading the locale dictionary');
}

function loadLocalePacks() {
    const literalStart = source.indexOf('const I18N = {');
    assert.ok(literalStart >= 0, 'Expected to find the I18N literal');
    const openBrace = source.indexOf('{', literalStart);
    const chunks = ['I18N = ' + readBlock(openBrace)];

    for (const locale of ['zh-TW', 'en-US']) {
        const marker = `Object.assign(I18N['${locale}'].remote, `;
        const markerIndex = source.indexOf(marker);
        assert.ok(markerIndex >= 0, `Expected the post-literal Object.assign for ${locale}`);
        const assignOpen = source.indexOf('{', markerIndex);
        chunks.push(`${marker}${readBlock(assignOpen)});`);
    }

    const sandbox = { currentLocale: 'zh-TW', I18N: undefined };
    return vm.runInNewContext(`${chunks.join('\n')}\nI18N;`, sandbox, { filename: sourcePath });
}

function resolveKey(pack, keyPath) {
    return keyPath.split('.').reduce((value, part) => (value == null ? undefined : value[part]), pack);
}

test('every static t() key resolves in both locales', () => {
    const packs = loadLocalePacks();
    const keys = new Set();
    for (const match of source.matchAll(/\bt\(\s*(['"])([^'"\n]+)\1/g)) keys.add(match[2]);

    assert.ok(keys.size >= 250, `Expected to scan the real t() calls, saw ${keys.size}`);

    const missing = [];
    for (const key of keys) {
        for (const locale of ['zh-TW', 'en-US']) {
            if (typeof resolveKey(packs[locale], key) !== 'string') missing.push(`${locale}:${key}`);
        }
    }
    assert.deepEqual(missing, [], `Missing translation keys: ${missing.join(', ')}`);
});

test('experience panel labels exist in both locales', () => {
    const packs = loadLocalePacks();
    for (const locale of ['zh-TW', 'en-US']) {
        for (const key of ['filter_all_sops', 'no_match', 'no_data', 'unnamed']) {
            assert.equal(typeof packs[locale].exps[key], 'string', `${locale}.exps.${key} should be defined`);
        }
    }
});

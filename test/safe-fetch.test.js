'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const http = require('node:http');
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

function deferred() {
    let resolve;
    const promise = new Promise((yes) => { resolve = yes; });
    return { promise, resolve };
}

function withGuard(promise, ms = 500) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`test guard: operation did not settle within ${ms} ms`)), ms);
        promise.then(
            (value) => { clearTimeout(timer); resolve(value); },
            (error) => { clearTimeout(timer); reject(error); },
        );
    });
}

(async () => {
    await assert.rejects(() => safeFetchText('http://127.0.0.1:3210/api/llm/config'), /blocked/);
    passed++;
    await assert.rejects(() => safeFetchText('http://169.254.169.254/latest/meta-data'), /blocked/);
    passed++;

    const hangingLookup = () => new Promise(() => {});
    const timeoutStarted = Date.now();
    await assert.rejects(
        withGuard(safeFetchText('https://example.com', { lookup: hangingLookup, timeoutMs: 25 }), 300),
        /Request timed out/,
    );
    assert.ok(Date.now() - timeoutStarted < 300, 'DNS lookup must count toward the total timeout');
    passed++;

    const abortController = new AbortController();
    const abortStarted = Date.now();
    const abortingFetch = safeFetchText('https://example.com', {
        lookup: hangingLookup,
        timeoutMs: 2000,
        signal: abortController.signal,
    });
    setTimeout(() => abortController.abort(), 10);
    await assert.rejects(withGuard(abortingFetch, 300), /Request aborted/);
    assert.ok(Date.now() - abortStarted < 300, 'external abort must interrupt a hanging DNS lookup');
    passed++;

    const lateLookup = deferred();
    const lateController = new AbortController();
    const originalRequest = http.request;
    let lateRequestCount = 0;
    http.request = () => {
        lateRequestCount += 1;
        throw new Error('late HTTP request should not start');
    };
    try {
        const lateFetch = safeFetchText('http://example.com', {
            lookup: () => lateLookup.promise,
            timeoutMs: 1000,
            signal: lateController.signal,
        }).then(() => 'resolved', (error) => error.message);
        lateController.abort();
        lateLookup.resolve([{ address: '8.8.8.8', family: 4 }]);
        assert.match(await withGuard(lateFetch, 300), /Request aborted/);
        await new Promise((resolve) => setTimeout(resolve, 10));
        assert.equal(lateRequestCount, 0, 'an aborted DNS result must not create a late HTTP request');
        passed++;
    } finally {
        http.request = originalRequest;
    }

    let lookupSignal = null;
    let pinnedLookup = null;
    http.request = (url, options, onResponse) => {
        pinnedLookup = options.lookup;
        const request = new EventEmitter();
        request.destroy = (error) => {
            setImmediate(() => request.emit('error', error));
            return request;
        };
        request.end = () => {
            setImmediate(() => {
                const response = new EventEmitter();
                response.statusCode = 200;
                response.headers = { 'content-type': 'text/plain' };
                onResponse(response);
                response.emit('data', Buffer.from('safe response'));
                response.emit('end');
                request.emit('close');
            });
        };
        return request;
    };
    try {
        const result = await safeFetchText('http://example.com', {
            lookup: async (hostname, options) => {
                lookupSignal = options.signal;
                return [{ address: '8.8.8.8', family: 4 }];
            },
        });
        assert.equal(result.ok, true);
        assert.equal(result.text, 'safe response');
        assert.ok(lookupSignal instanceof AbortSignal, 'DNS lookup must receive the request-scoped signal');
        assert.deepEqual(await new Promise((resolve) => {
            pinnedLookup('example.com', { all: true }, (error, addresses) => resolve(error ? [error] : addresses));
        }), [{ address: '8.8.8.8', family: 4 }], 'the pinned lookup must honor all-address requests');
        passed++;
    } finally {
        http.request = originalRequest;
    }

    console.log(`\n[safe-fetch.test] ${passed} passed`);
})().catch((error) => {
    console.error(error);
    process.exit(1);
});

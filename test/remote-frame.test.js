'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { test } = require('node:test');
const { RemoteAgentService } = require(path.join(__dirname, '..', 'src', 'remote-agent.js'));

const MAX_FRAME_BYTES = 16 * 1024 * 1024;

function createHarness() {
    const socket = new EventEmitter();
    socket.remoteAddress = '192.0.2.10';
    socket.remotePort = 50000;
    socket.destroyed = false;
    socket.ended = false;
    socket.encoding = null;
    socket.setEncoding = (encoding) => { socket.encoding = encoding; };
    socket.write = () => true;
    socket.end = () => { socket.ended = true; };
    socket.destroy = () => { socket.destroyed = true; };

    const errors = [];
    const payloads = [];
    const service = new RemoteAgentService({ onError: (error) => errors.push(error) });
    service.handlePayload = (target, payload) => payloads.push(payload);
    service.attachSocketHandlers(socket);
    return { service, socket, errors, payloads };
}

test('parses CRLF, blank lines and UTF-8 characters split across raw byte chunks', () => {
    const { service, socket, payloads, errors } = createHarness();
    const expected = [
        { type: 'chat_message', text: '繁體中文 🙂' },
        { type: 'chat_message', text: '第二則' },
    ];
    const bytes = Buffer.from(`${JSON.stringify(expected[0])}\r\n\n${JSON.stringify(expected[1])}\n`, 'utf8');
    const emojiOffset = bytes.indexOf(Buffer.from('🙂', 'utf8')) + 1;

    service.handleSocketData(socket, bytes.subarray(0, emojiOffset));
    service.handleSocketData(socket, bytes.subarray(emojiOffset, emojiOffset + 7));
    service.handleSocketData(socket, bytes.subarray(emojiOffset + 7));

    assert.deepEqual(payloads, expected);
    assert.deepEqual(errors, []);
    assert.equal(socket.destroyed, false);
});

test('keeps a trailing partial frame until its newline and accepts string chunks', () => {
    const { service, socket, payloads } = createHarness();
    const payload = { type: 'chat_message', text: 'waiting for delimiter' };

    service.handleSocketData(socket, Buffer.from(JSON.stringify(payload), 'utf8'));
    assert.deepEqual(payloads, []);
    service.handleSocketData(socket, '\r\n');

    assert.deepEqual(payloads, [payload]);
});

test('enforces the byte limit per frame instead of rejecting a large batch of small frames', () => {
    const { service, socket, payloads, errors } = createHarness();
    const text = 'x'.repeat(1024 * 1024);
    const batch = Buffer.from(Array.from({ length: 17 }, () => JSON.stringify({ type: 'bulk', text })).join('\n') + '\n');

    assert.ok(batch.length > MAX_FRAME_BYTES);
    service.handleSocketData(socket, batch);

    assert.equal(socket.destroyed, false);
    assert.deepEqual(errors, []);
    assert.equal(payloads.length, 17);
    assert.ok(payloads.every((payload) => payload.text === text));
});

test('accepts a frame of exactly 16 MiB and rejects one byte more', () => {
    const accepted = createHarness();
    const prefix = '{"type":"exact","text":"';
    const suffix = '"}';
    const padding = 'x'.repeat(MAX_FRAME_BYTES - Buffer.byteLength(prefix + suffix, 'utf8'));
    const exact = Buffer.from(prefix + padding + suffix + '\n', 'utf8');
    assert.equal(exact.length - 1, MAX_FRAME_BYTES);

    accepted.service.handleSocketData(accepted.socket, exact);
    assert.equal(accepted.socket.destroyed, false);
    assert.equal(accepted.payloads.length, 1);
    assert.equal(accepted.payloads[0].type, 'exact');

    const rejected = createHarness();
    rejected.service.handleSocketData(rejected.socket, exact.subarray(0, exact.length - 1));
    rejected.service.handleSocketData(rejected.socket, Buffer.from('x\n', 'utf8'));
    assert.equal(rejected.socket.destroyed, true);
    assert.equal(rejected.payloads.length, 0);
    assert.match(rejected.errors[0].message, /16 MiB/);
});

test('does not rescan an incomplete frame on every data event', () => {
    const { service, socket, errors } = createHarness();
    const chunk = Buffer.alloc(64 * 1024, 0x78);
    const originalByteLength = Buffer.byteLength;
    let byteLengthCalls = 0;
    Buffer.byteLength = function (...args) {
        byteLengthCalls += 1;
        return originalByteLength.apply(this, args);
    };
    try {
        for (let index = 0; index < 128; index += 1) service.handleSocketData(socket, chunk);
    } finally {
        Buffer.byteLength = originalByteLength;
    }

    assert.equal(byteLengthCalls, 0, 'the pending frame must not be re-encoded and measured for every chunk');
    assert.equal(socket.destroyed, false);
    assert.deepEqual(errors, []);
});

test('reports malformed JSON without stopping later frames', () => {
    const { service, socket, payloads, errors } = createHarness();
    const expected = { type: 'after-bad-json' };

    service.handleSocketData(socket, Buffer.from(`{bad}\n${JSON.stringify(expected)}\n`, 'utf8'));

    assert.deepEqual(payloads, [expected]);
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /Remote payload parse failed/);
    assert.equal(socket.destroyed, false);
});

test('releases large frame capacity while preserving a trailing partial frame', () => {
    const { service, socket, payloads } = createHarness();
    const first = { type: 'large', text: 'x'.repeat(1024 * 1024) };
    const second = { type: 'next', text: 'after-large-frame' };
    const secondBytes = Buffer.from(JSON.stringify(second), 'utf8');
    const splitAt = secondBytes.length - 5;
    const initial = Buffer.concat([
        Buffer.from(`${JSON.stringify(first)}\n`, 'utf8'),
        secondBytes.subarray(0, splitAt),
    ]);

    service.handleSocketData(socket, initial);
    assert.deepEqual(payloads, [first]);
    assert.equal(socket._remoteAgentBufferLength, splitAt);
    assert.ok(socket._remoteAgentBuffer.length < 64 * 1024);

    service.handleSocketData(socket, Buffer.concat([secondBytes.subarray(splitAt), Buffer.from('\n')]));
    assert.deepEqual(payloads, [first, second]);
});

test('attaches raw Buffer handlers instead of decoding the whole socket stream', () => {
    const { socket } = createHarness();
    assert.equal(socket.encoding, null);
});

'use strict';

// APPDATA debug.log 的寫入與讀取：寫入有上限、讀取只碰尾端。
// 先前 appendFileSync 從不輪替，診斷視窗又把整份檔案讀進記憶體只為取最後 80 行。
const fs = require('node:fs');

const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_TAIL_BYTES = 256 * 1024;

function readTailBytes(logPath, maxBytes) {
    const fd = fs.openSync(logPath, 'r');
    try {
        const size = fs.fstatSync(fd).size;
        const length = Math.min(size, Math.max(0, maxBytes));
        const buffer = Buffer.alloc(length);
        if (length > 0) fs.readSync(fd, buffer, 0, length, size - length);
        return buffer.toString('utf8');
    } finally {
        fs.closeSync(fd);
    }
}

// 從尾端截取時開頭可能是半行（甚至半個 UTF-8 字元），丟掉第一個不完整行。
function dropPartialFirstLine(text) {
    const firstBreak = text.indexOf('\n');
    return firstBreak === -1 ? '' : text.slice(firstBreak + 1);
}

function appendDebugLog(logPath, message, options = {}) {
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    const timestamp = options.timestamp ?? new Date().toISOString();
    fs.appendFileSync(logPath, `[${timestamp}] ${message}\n`, 'utf8');
    if (fs.statSync(logPath).size <= maxBytes) return;
    // 超過上限只留尾端一半，之後要再累積半份才會重寫，不會每次 append 都搬整份檔案。
    const keepBytes = Math.max(1, Math.floor(maxBytes / 2));
    fs.writeFileSync(logPath, dropPartialFirstLine(readTailBytes(logPath, keepBytes)), 'utf8');
}

function readDebugLogTail(logPath, maxLines = 80, options = {}) {
    const tailBytes = options.tailBytes ?? DEFAULT_TAIL_BYTES;
    try {
        if (!fs.existsSync(logPath)) {
            return { path: logPath, lines: [], exists: false };
        }
        const lines = readTailBytes(logPath, tailBytes)
            .split(/\r?\n/)
            .filter(Boolean)
            .slice(-Math.max(1, maxLines));
        return { path: logPath, lines, exists: true };
    } catch (error) {
        return { path: logPath, lines: [`Failed to read debug log: ${error.message}`], exists: false };
    }
}

module.exports = {
    appendDebugLog,
    readDebugLogTail,
    dropPartialFirstLine,
    DEFAULT_MAX_BYTES,
    DEFAULT_TAIL_BYTES,
};

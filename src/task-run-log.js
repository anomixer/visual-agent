'use strict';

// 執行中的任務日誌改用 append-only JSONL 落地。
// tasks.json 每次寫入都是整份重寫，執行期間逐筆 checkpoint 會連歷史任務的 logs 一起重送
// （實測 50 個歷史任務 × 3600 筆時單次寫入 38 MB / 101 ms），因此這裡只追加新增的那一行。

const RUN_LOG_FILE_NAME = 'running-task.jsonl';
const TERMINAL_STATUSES = new Set(['success', 'failed', 'skipped']);

function normalizeRunLogOutcome(outcome) {
    if (!outcome || typeof outcome !== 'object' || Array.isArray(outcome)) return null;
    if (!TERMINAL_STATUSES.has(outcome.status)) return null;
    if (typeof outcome.completedAt !== 'string' || !Number.isFinite(Date.parse(outcome.completedAt))) return null;
    return { status: outcome.status, completedAt: outcome.completedAt };
}

function serializeRunLogRecord(taskId, progress, entry, outcome) {
    const record = { taskId, progress, entry: entry || null };
    const terminal = normalizeRunLogOutcome(outcome);
    if (terminal) record.outcome = terminal;
    return `${JSON.stringify(record)}\n`;
}

// 行程被強制結束時最後一行可能只寫到一半，因此逐行寬容解析，不讓整份記錄報廢。
function parseRunLog(text, taskId) {
    const logs = [];
    let progress = null;
    let outcome = null;
    for (const line of String(text || '').split('\n')) {
        if (!line.trim()) continue;
        let record;
        try {
            record = JSON.parse(line);
        } catch {
            continue;
        }
        if (!record || record.taskId !== taskId) continue;
        if (Number.isFinite(record.progress)) progress = record.progress;
        if (record.entry) logs.push(record.entry);
        const terminal = normalizeRunLogOutcome(record.outcome);
        if (terminal) outcome = terminal;
    }
    const result = { logs, progress };
    if (outcome) result.outcome = outcome;
    return result;
}

module.exports = { RUN_LOG_FILE_NAME, serializeRunLogRecord, parseRunLog };
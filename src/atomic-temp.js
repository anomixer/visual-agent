const fs = require('fs');
const path = require('path');

function defaultIsProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return error?.code !== 'ESRCH';
    }
}

function cleanupStaleAtomicTempFiles(directory, baseName, options = {}) {
    const isProcessAlive = options.isProcessAlive || defaultIsProcessAlive;
    const currentPid = options.currentPid ?? process.pid;
    let entries;
    try {
        entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
        return [];
    }

    const prefix = `${baseName}.`;
    const removed = [];
    for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (!entry.name.startsWith(prefix) || !entry.name.endsWith('.tmp')) continue;
        const pidText = entry.name.slice(prefix.length, -'.tmp'.length);
        if (!/^[1-9]\d*$/.test(pidText)) continue;
        const pid = Number(pidText);
        if (!Number.isSafeInteger(pid) || pid === currentPid) continue;

        let alive = true;
        try {
            alive = isProcessAlive(pid);
        } catch {
            continue;
        }
        if (alive) continue;

        try {
            fs.unlinkSync(path.join(directory, entry.name));
            removed.push(entry.name);
        } catch {}
    }
    return removed;
}

module.exports = { cleanupStaleAtomicTempFiles };

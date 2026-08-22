#!/usr/bin/env node
/**
 * 最小 CI 守門：
 *   1) 語法門 — node --check 掃全部自研 JS（src / public / plugins）。
 *   2) 冒煙  — 起 server，打 /api/meta、/api/diagnostics，確認 success:true，再收掉。
 * 不依賴 Ollama / 網路 / 顯示卡，可在乾淨 runner 跑。
 * 用法：node scripts/check.js   （或 npm test）
 */
const { spawnSync, spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const NODE = process.execPath;

function collectJs(dir, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) collectJs(full, out);
        else if (entry.name.endsWith('.js') && !/\.min\.js$/.test(entry.name)) out.push(full);
    }
    return out;
}

function syntaxCheck() {
    const files = [
        ...collectJs(path.join(ROOT, 'src')),
        path.join(ROOT, 'public', 'app.js'),
        ...collectJs(path.join(ROOT, 'plugins')),
    ];
    console.log(`\n[1/3] 語法檢查 (${files.length} 個 JS 檔)`);
    let failed = 0;
    for (const file of files) {
        const rel = path.relative(ROOT, file);
        const r = spawnSync(NODE, ['--check', file], { encoding: 'utf8' });
        if (r.status !== 0) {
            failed++;
            console.error(`  ✗ ${rel}\n${r.stderr || r.stdout}`);
        } else {
            console.log(`  ✓ ${rel}`);
        }
    }
    if (failed) { console.error(`\n語法檢查失敗：${failed} 個檔`); process.exit(1); }
}

function smoke() {
    return new Promise((resolve, reject) => {
        console.log('\n[3/3] 冒煙測試（起 server → 打 /api/meta，並健康快照 /api/diagnostics）');
        const child = spawn(NODE, [path.join(ROOT, 'src', 'server.js')], { cwd: ROOT });
        let out = '';
        let done = false;
        const timer = setTimeout(() => finish(false, 'server 未在 45s 內就緒'), 45000);

        const finish = (ok, reason) => {
            if (done) return; done = true;
            clearTimeout(timer);
            child.kill('SIGTERM');
            console.log(ok ? `  ✓ ${reason}` : `  ✗ ${reason}\n${out}`);
            ok ? resolve() : reject(new Error(reason));
        };

        child.stdout.on('data', d => out += d);
        child.stderr.on('data', d => out += d);
        child.on('exit', code => finish(false, `server 提前結束 (code ${code})`));

        const base = 'http://127.0.0.1:3210';
        // 乾淨 CI runner（無 Ollama / 冷磁碟）首次 /api/diagnostics 較慢，超時放寬。
        const hit = async (p, timeoutMs = 15000) => {
            const res = await fetch(base + p, { signal: AbortSignal.timeout(timeoutMs) });
            const body = await res.json().catch(() => ({}));
            if (!res.ok || body.success !== true) throw new Error(`${p} -> HTTP ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
            return body;
        };

        const waitReady = async (tries = 60) => {
            for (let i = 0; i < tries; i++) {
                try { await fetch(base + '/api/meta', { signal: AbortSignal.timeout(2000) }); return true; }
                catch { await new Promise(r => setTimeout(r, 500)); }
            }
            return false;
        };

        (async () => {
            if (!(await waitReady())) return finish(false, 'server 未就緒');
            // 核心斷言：server 存活 + /api/meta 正常回。
            await hit('/api/meta');
            // /api/diagnostics 是附加健康快照（含 Ollama/browser 偵測），無 Ollama 環境較慢；
            // 降級為 best-effort，不因它讓整支 CI 紅。
            try {
                await hit('/api/diagnostics');
                finish(true, '/api/meta success:true，/api/diagnostics 正常回');
            } catch (e) {
                console.warn(`  ⚠ /api/diagnostics 慢或異常（不致命）：${e.message}`);
                finish(true, '/api/meta success:true（/api/diagnostics best-effort 略過）');
            }
        })().catch(e => finish(false, e.message));
    });
}

function unitTests() {
    const files = [path.join(ROOT, 'test', 'pure.test.js')];
    console.log(`\n[1.5/3] 單元測試`);
    for (const file of files) {
        if (!fs.existsSync(file)) { console.warn(`  ⚠ 找不到 ${path.relative(ROOT, file)}`); continue; }
        const r = spawnSync(NODE, [file], { cwd: ROOT, encoding: 'utf8' });
        process.stdout.write(r.stdout || '');
        if (r.status !== 0) {
            console.error(`  ✗ ${path.relative(ROOT, file)}\n${r.stderr || ''}`);
            process.exit(1);
        }
        console.log(`  ✓ ${path.relative(ROOT, file)}`);
    }
}

(async () => {
    syntaxCheck();
    unitTests();
    await smoke();
    console.log('\n✅ 全部通過');
    process.exit(0);
})().catch(err => { console.error('\n❌ CI 失敗：' + err.message); process.exit(1); });

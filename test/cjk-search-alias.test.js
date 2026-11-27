'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { test } = require('node:test');
const { createChatHarness } = require('./helpers/chat-harness');
const { parseSOPContent } = require('../src/sop-parser');

const ROOT = path.join(__dirname, '..');

function bundledSkillFiles() {
    const skillsDir = path.join(ROOT, 'skills');
    const files = {};
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const skillFile = path.join(skillsDir, entry.name, 'SKILL.md');
        if (!fs.existsSync(skillFile)) continue;
        files[path.join('appdata', 'visual-agent', 'skills', entry.name, 'SKILL.md')] = fs.readFileSync(skillFile, 'utf8');
    }
    return files;
}

function bundledSops() {
    const sopsDir = path.join(ROOT, 'sops');
    return fs.readdirSync(sopsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => {
            const sourceFile = path.join(sopsDir, entry.name, 'SOP.md');
            return parseSOPContent(fs.readFileSync(sourceFile, 'utf8'), sourceFile);
        });
}

function sectionLines(context, header, nextHeader) {
    const section = context.split(`${header}:\n`)[1]?.split(`\n\n${nextHeader}:`)[0] || '';
    return section.split('\n').filter(Boolean);
}

function skillNames(context) {
    return sectionLines(context, 'Relevant Skills', 'Relevant SOPs')
        .map((line) => line.match(/^\d+\. (.+?):/)?.[1])
        .filter(Boolean);
}

function sopIds(context) {
    return sectionLines(context, 'Relevant SOPs', 'If these are still insufficient')
        .map((line) => line.match(/ID=([^,]+)/)?.[1])
        .filter(Boolean);
}

function createCorpusHarness(t) {
    const files = bundledSkillFiles();
    assert.ok(Object.keys(files).length >= 37, 'Lock the real bundled Skill corpus used by this regression');
    const harness = createChatHarness({ seedFiles: files });
    t.after(() => {
        harness.dispose();
        harness.assertSafe();
    });
    return harness;
}

test('中文意圖透過固定別名排名到真實 Skill 文件', (t) => {
    const harness = createCorpusHarness(t);
    const cases = [
        ['幫我修印表機', 'windows-printer-troubleshoot'],
        ['印表機不能列印', 'windows-printer-troubleshoot'],
        ['我想備份還原檔案', 'backup-restore'],
        ['辦公室Excel公式', 'office-excel-assistant'],
        ['我想找可以畫圖的軟體', 'media-editing-assistant'],
        ['磁碟空間不足', 'windows-storage-recovery'],
    ];
    for (const [query, expected] of cases) {
        const names = skillNames(harness.buildOnDemandSkillAndSopContext(query, [], 'en-US'));
        assert.equal(names[0], expected, `${query}: ${names.join(', ')}`);
        assert.ok(names.length <= 4, `${query} must retain the top-4 Skill limit`);
    }

    const recovered = skillNames(harness.buildOnDemandSkillAndSopContext('檔案不見可以救回嗎', [], 'en-US'));
    assert.ok(recovered.includes('backup-restore'), recovered.join(', '));
    assert.ok(recovered.includes('windows-storage-recovery'), recovered.join(', '));

    const browser = skillNames(harness.buildOnDemandSkillAndSopContext('瀏覽器搜尋資料', [], 'en-US'));
    assert.ok(browser.includes('browser-research-and-edit'), browser.join(', '));
});

test('中文移除與備份還原意圖排名到真實 SOP', (t) => {
    const harness = createCorpusHarness(t);
    const sops = bundledSops();
    assert.ok(sops.length >= 16, 'Lock the real bundled SOP corpus used by this regression');

    for (const query of ['移除Copilot', '把Copilot從電腦移除']) {
        const ids = sopIds(harness.buildOnDemandSkillAndSopContext(query, sops, 'en-US'));
        assert.equal(ids[0], 'rec_remove_copilot', `${query}: ${ids.join(', ')}`);
        assert.ok(ids.length <= 5, `${query} must retain the top-5 SOP limit`);
    }

    const backup = sopIds(harness.buildOnDemandSkillAndSopContext('我想備份還原檔案', sops, 'en-US'));
    assert.ok(backup.includes('sys_backup_user_files'), backup.join(', '));
    assert.ok(backup.includes('sys_restore_user_files'), backup.join(', '));
});

test('英文查詢與無匹配 fallback 維持原行為', (t) => {
    const harness = createCorpusHarness(t);
    const english = harness.buildOnDemandSkillAndSopContext('printer troubleshooting', [], 'en-US');
    assert.equal(skillNames(english)[0], 'windows-printer-troubleshoot');

    const unmatched = harness.buildOnDemandSkillAndSopContext('qzxvqzxv', [], 'en-US');
    assert.match(unmatched, /^No direct internal skill\/SOP match found\./);
});

test('長查詢仍保留中文別名且不擴大 16-token 預算', (t) => {
    const harness = createCorpusHarness(t);
    const filler = Array.from({ length: 26 }, (_, index) => `qzxv${String(index).padStart(2, '0')}`).join(' ');
    const query = `${filler} 幫我修印表機`;
    const names = skillNames(harness.buildOnDemandSkillAndSopContext(query, [], 'en-US'));
    assert.equal(names[0], 'windows-printer-troubleshoot', names.join(', '));
});

test('真實 /api/chat 把中文查詢對應的 Skill 情境注入 LLM request', async (t) => {
    const harness = createCorpusHarness(t);
    harness.setReplies(['Printer troubleshooting fixture answer.']);
    let server;
    t.after(async () => {
        try {
            if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        } finally {
            harness.assertSafe();
        }
    });
    server = harness.app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    });

    let token = '';
    function request(method, route, body) {
        const payload = body === undefined ? null : JSON.stringify(body);
        return new Promise((resolve, reject) => {
            const req = http.request({
                host: '127.0.0.1', port: server.address().port, path: route, method, agent: false,
                headers: {
                    Host: '127.0.0.1:3210',
                    ...(token ? { 'X-Visual-Agent-Token': token } : {}),
                    ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
                },
            }, (res) => {
                let raw = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => { raw += chunk; });
                res.on('error', reject);
                res.on('end', () => {
                    try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
                    catch { reject(new Error(`Non-JSON ${res.statusCode} from ${route}: ${raw.slice(0, 300)}`)); }
                });
            });
            req.setTimeout(5000, () => req.destroy(new Error(`Timed out: ${route}`)));
            req.on('error', reject);
            req.end(payload);
        });
    }

    const meta = await request('GET', '/api/meta');
    assert.equal(meta.status, 200);
    token = meta.body.localApiToken;
    assert.ok(token, 'Fetch the real middleware token via /api/meta');
    const response = await request('POST', '/api/chat', {
        message: '幫我修印表機', locale: 'zh-TW', localChatSessionId: 'cjk-alias-session',
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.success, true, JSON.stringify(response.body));
    assert.equal(harness.llmCalls.length, 1);
    assert.match(harness.llmCalls[0].message, /windows-printer-troubleshoot/);
    assert.match(harness.llmCalls[0].message, /相關 Skills/);
});

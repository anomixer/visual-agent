'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { createChatHarness } = require('./helpers/chat-harness');

const ROOT = path.resolve(__dirname, '..');
const LLM_PATH = path.join(ROOT, 'src', 'llm.js');

function tempDir(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-agent-atomic-startup-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}

test('llm startup removes a dead process temp but preserves its own PID temp', (t) => {
    const appDataRoot = tempDir(t);
    const appDataDir = path.join(appDataRoot, 'visual-agent');
    fs.mkdirSync(appDataDir, { recursive: true });
    const configPath = path.join(appDataDir, 'config.json');

    const exited = spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' });
    assert.equal(exited.status, 0, exited.stderr);
    const stalePath = `${configPath}.${exited.pid}.tmp`;
    fs.writeFileSync(stalePath, '{"half":"config');

    const script = `
        const fs = require('node:fs');
        const configPath = ${JSON.stringify(configPath)};
        const currentPath = configPath + '.' + process.pid + '.tmp';
        fs.writeFileSync(currentPath, 'current process temp');
        require(${JSON.stringify(LLM_PATH)});
        process.stdout.write('RESULT:' + JSON.stringify({
            stale: fs.existsSync(configPath + '.${exited.pid}.tmp'),
            current: fs.existsSync(currentPath),
        }));
    `;
    const child = spawnSync(process.execPath, ['-e', script], {
        cwd: ROOT,
        env: { ...process.env, APPDATA: appDataRoot },
        encoding: 'utf8',
        timeout: 30000,
    });

    assert.equal(child.status, 0, child.stderr);
    const line = child.stdout.split(/\r?\n/).find((text) => text.startsWith('RESULT:'));
    assert.ok(line, child.stdout);
    assert.deepEqual(JSON.parse(line.slice('RESULT:'.length)), { stale: false, current: true });
});

test('server startup removes stale remote-profile and tasks temp files only', (t) => {
    const harness = createChatHarness({ seedFiles: {
        'appdata/visual-agent/remote-profile.json.999998.tmp': '{"half":"remote',
        'appdata/visual-agent/tasks.json.999997.tmp': '{"half":"tasks',
        'appdata/visual-agent/tasks.json.424242.tmp': '{"owned":"current-fixture-process"}',
    } });
    t.after(() => {
        harness.dispose();
        harness.assertSafe();
    });

    const files = Object.keys(harness.getFiles());
    assert.equal(files.some((file) => file.endsWith('remote-profile.json.999998.tmp')), false);
    assert.equal(files.some((file) => file.endsWith('tasks.json.999997.tmp')), false);
    assert.equal(files.some((file) => file.endsWith('tasks.json.424242.tmp')), true);
});

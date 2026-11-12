'use strict';
// SKILL.md frontmatter 解析 — agentskills.io 把 category / tags 縮排在 metadata: 底下。
// 只讀 repo 內建 skills/，不啟 server、不執行 PowerShell、不碰使用者 APPDATA。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { parseSkillFrontmatter } = require('../src/pure');

const SKILLS_DIR = path.join(__dirname, '..', 'skills');
const SERVER_PATH = path.join(__dirname, '..', 'src', 'server.js');

function bundledSkills() {
    return fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => ({ slug: entry.name, file: path.join(SKILLS_DIR, entry.name, 'SKILL.md') }))
        .filter((entry) => fs.existsSync(entry.file))
        .map((entry) => {
            const content = fs.readFileSync(entry.file, 'utf8');
            const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/m);
            return { ...entry, frontmatter: fm ? fm[1] : '' };
        });
}

const NESTED = [
    'name: hermes-apple',
    'description: Apple / macOS skills — Finder, native apps, screenshots.',
    'license: Apache-2.0',
    'source: hermes-agent',
    'metadata:',
    '  author: NousResearch',
    '  version: "1.0"',
    '  tags: apple macos finder screenshots',
    '  category: platform',
].join('\n');

test('nested metadata tags and category are parsed', () => {
    const parsed = parseSkillFrontmatter(NESTED, 'fallback-slug');
    assert.equal(parsed.name, 'hermes-apple');
    assert.equal(parsed.category, 'platform');
    assert.deepEqual(parsed.tags, ['apple', 'macos', 'finder', 'screenshots']);
    assert.equal(parsed.source, 'hermes-agent');
    assert.equal(parsed.description, 'Apple / macOS skills — Finder, native apps, screenshots.');
});

test('the spec array form and comma separated tags both split', () => {
    const array = parseSkillFrontmatter('metadata:\n  tags: ["system", "tool"]');
    assert.deepEqual(array.tags, ['system', 'tool']);
    const commas = parseSkillFrontmatter('metadata:\n  tags: system, tool , driver');
    assert.deepEqual(commas.tags, ['system', 'tool', 'driver']);
});

test('a nested block list keeps multi-word items whole', () => {
    const parsed = parseSkillFrontmatter('metadata:\n  tags:\n    - note taking\n    - "study notes"\n    -');
    assert.deepEqual(parsed.tags, ['note taking', 'study notes']);
});

test('top-level keys still parse and win over nested duplicates', () => {
    const legacy = parseSkillFrontmatter('name: legacy\ncategory: Browser\ntags: a, b\nsource: visual-agent');
    assert.equal(legacy.category, 'Browser');
    assert.deepEqual(legacy.tags, ['a', 'b']);
    assert.equal(legacy.source, 'visual-agent');

    const both = parseSkillFrontmatter('category: Browser\nmetadata:\n  category: platform');
    assert.equal(both.category, 'Browser');
});

test('quotes are stripped and a description may contain colons', () => {
    const parsed = parseSkillFrontmatter('name: "quoted-slug"\ndescription: Use when: the model is offline\ncategory: \'AI Engine\'');
    assert.equal(parsed.name, 'quoted-slug');
    assert.equal(parsed.description, 'Use when: the model is offline');
    assert.equal(parsed.category, 'AI Engine');
});

test('missing or empty frontmatter falls back to the slug and Skills', () => {
    for (const input of ['', undefined, null, 'license: MIT']) {
        const parsed = parseSkillFrontmatter(input, 'fallback-slug');
        assert.deepEqual(parsed, {
            name: 'fallback-slug', description: '', category: 'Skills', tags: [], source: '',
        });
    }
    assert.equal(parseSkillFrontmatter('name:\ndescription:\ntags:\ncategory:').name, '');
});

test('CRLF and tab indentation parse the same as LF and spaces', () => {
    const crlf = parseSkillFrontmatter(NESTED.replace(/\n/g, '\r\n'), 'fallback-slug');
    assert.equal(crlf.category, 'platform');
    assert.deepEqual(crlf.tags, ['apple', 'macos', 'finder', 'screenshots']);
    const tabs = parseSkillFrontmatter('metadata:\n\ttags: a b\n\tcategory: media');
    assert.deepEqual(tabs.tags, ['a', 'b']);
    assert.equal(tabs.category, 'media');
});

test('unrelated metadata keys and URLs are not mistaken for fields', () => {
    const parsed = parseSkillFrontmatter([
        'name: demo',
        'hermes_origin: https://github.com/NousResearch/hermes-agent/tree/main/skills/apple',
        'compatibility:',
        '  - windows',
        'metadata:',
        '  author: someone',
        '  tags: demo',
    ].join('\n'));
    assert.equal(parsed.name, 'demo');
    assert.deepEqual(parsed.tags, ['demo']);
    assert.equal(parsed.category, 'Skills');
});

test('every bundled skill exposes its tags', () => {
    const skills = bundledSkills();
    assert.ok(skills.length >= 37, `expected the bundled skill library, got ${skills.length}`);
    for (const skill of skills) {
        const parsed = parseSkillFrontmatter(skill.frontmatter, skill.slug);
        assert.ok(parsed.tags.length >= 1, `${skill.slug} must expose at least one tag`);
        assert.ok(parsed.tags.every((tag) => tag && !tag.includes(' ')), `${skill.slug} tags must be single keywords: ${JSON.stringify(parsed.tags)}`);
        assert.equal(parsed.name, skill.slug);
        assert.ok(parsed.description.length > 0, `${skill.slug} must keep its description`);
    }
});

test('bundled Hermes skills keep their real category, native ones default to Skills', () => {
    const skills = bundledSkills();
    const hermes = skills.filter((skill) => skill.slug.startsWith('hermes-'));
    const native = skills.filter((skill) => !skill.slug.startsWith('hermes-'));
    assert.ok(hermes.length >= 19 && native.length >= 18);
    for (const skill of hermes) {
        const parsed = parseSkillFrontmatter(skill.frontmatter, skill.slug);
        assert.notEqual(parsed.category, 'Skills', `${skill.slug} must not fall back to Skills`);
        assert.equal(parsed.source, 'hermes-agent');
    }
    for (const skill of native) {
        assert.equal(parseSkillFrontmatter(skill.frontmatter, skill.slug).category, 'Skills');
    }
    const categories = new Set(hermes.map((skill) => parseSkillFrontmatter(skill.frontmatter, skill.slug).category));
    assert.ok(categories.size >= 10, `expected the Hermes category spread, got ${[...categories].join(', ')}`);
});

test('server.js parses frontmatter through the shared helper', () => {
    const source = fs.readFileSync(SERVER_PATH, 'utf8');
    assert.ok(source.includes('parseSkillFrontmatter,'), 'server.js must import the helper');
    assert.ok(source.includes('} = parseSkillFrontmatter(fmText, entry.name);'), 'loadSkillDocuments must delegate to the helper');
    assert.equal(/fmText\.match\(\/\^(tags|category):/.test(source), false, 'the line-start-only regexes must be gone');
});

// ── /api/skills 端到端：真實 HTTP + 隔離 harness，skill 只存在記憶體沙箱 ──
const http = require('node:http');
const { once } = require('node:events');
const { createChatHarness } = require('./helpers/chat-harness');

function request(port, route, token) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            host: '127.0.0.1', port, path: route, method: 'GET', agent: false,
            headers: { Host: '127.0.0.1:3210', 'X-Visual-Agent-Token': token },
        }, (res) => {
            let raw = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { raw += chunk; });
            res.on('error', reject);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
                catch { reject(new Error(`Non-JSON ${res.statusCode} from ${route}: ${raw.slice(0, 200)}`)); }
            });
        });
        req.setTimeout(5000, () => req.destroy(new Error(`Timed out: ${route}`)));
        req.on('error', reject);
        req.end();
    });
}

test('GET /api/skills returns nested tags, category and source', async (t) => {
    const harness = createChatHarness({
        seedFiles: {
            'appdata/visual-agent/skills/probe-nested/SKILL.md': [
                '---',
                'name: probe-nested',
                'description: Synthetic skill for the frontmatter regression test.',
                'metadata:',
                '  tags: probe nested regression',
                '  category: research',
                '---',
                '',
                '## Role',
                'Synthetic content.',
            ].join('\n'),
            'appdata/visual-agent/skills/probe-plain/SKILL.md': [
                '---',
                'name: probe-plain',
                'description: Synthetic skill without metadata.',
                '---',
                '',
                '## Role',
                'Synthetic content.',
            ].join('\n'),
            'appdata/visual-agent/skills/hermes-probe/SKILL.md': [
                '---',
                'name: hermes-probe',
                'description: Synthetic converted skill.',
                'source: hermes-agent',
                'metadata:',
                '  tags: probe converted',
                '  category: media',
                '---',
                '',
                '## Role',
                'Synthetic content.',
            ].join('\n'),
        },
    });
    const server = harness.app.listen(0, '127.0.0.1');
    t.after(async () => {
        try {
            await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        } finally {
            harness.dispose();
            harness.assertSafe();
        }
    });
    await once(server, 'listening');
    const port = server.address().port;
    const meta = await request(port, '/api/meta', '');
    const token = meta.body.localApiToken;
    assert.ok(token, 'local API token should be available');

    const response = await request(port, '/api/skills', token);
    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    const nested = response.body.skills.find((skill) => skill.slug === 'probe-nested');
    const plain = response.body.skills.find((skill) => skill.slug === 'probe-plain');
    const hermes = response.body.skills.find((skill) => skill.slug === 'hermes-probe');
    assert.deepEqual(nested.tags, ['probe', 'nested', 'regression']);
    assert.equal(nested.category, 'research');
    assert.deepEqual(plain.tags, []);
    assert.equal(plain.category, 'Skills');
    // 前端以 source 分成 Visual Agent / From Hermes Agent 兩群，漏掉這個欄位會讓 37 支全部歸在同一群。
    assert.equal(nested.source, 'visual-agent');
    assert.equal(plain.source, 'visual-agent');
    assert.equal(hermes.source, 'hermes-agent');
    assert.equal(hermes.category, 'media');
    assert.deepEqual(hermes.tags, ['probe', 'converted']);
});
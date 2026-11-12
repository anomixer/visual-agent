'use strict';
// Skills 面板的分類與來源標題 — 擷取 public/app.js 的真實 renderSkillList，
// 分類來源用 src/pure.js 的真實 parseSkillFrontmatter 讀 repo skills/（唯讀）。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { parseSkillFrontmatter } = require('../src/pure.js');

const sourcePath = path.join(__dirname, '..', 'public', 'app.js');
const source = fs.readFileSync(sourcePath, 'utf8');

function extractFunction(name) {
    const pattern = new RegExp(`^(?:async )?function ${name}\\([^)]*\\) \\{[^]*?^\\}\\r?$`, 'gm');
    const match = [...source.matchAll(pattern)];
    assert.equal(match.length, 1, `Expected one actual declaration of ${name}`);
    return match[0];
}

function readBlock(startIndex) {
    let depth = 0;
    for (let i = startIndex; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}') {
            depth--;
            if (depth === 0) return source.slice(startIndex, i + 1);
        }
    }
    throw new Error('Unbalanced block while reading the locale dictionary');
}

function loadLocalePacks(locale) {
    const literalStart = source.indexOf('const I18N = {');
    assert.ok(literalStart >= 0, 'Expected to find the I18N literal');
    const chunks = ['I18N = ' + readBlock(source.indexOf('{', literalStart))];
    for (const packLocale of ['zh-TW', 'en-US']) {
        const marker = `Object.assign(I18N['${packLocale}'].remote, `;
        const markerIndex = source.indexOf(marker);
        assert.ok(markerIndex >= 0, `Expected the post-literal Object.assign for ${packLocale}`);
        chunks.push(`${marker}${readBlock(source.indexOf('{', markerIndex))});`);
    }
    return vm.runInNewContext(`${chunks.join('\n')}\nI18N;`, { currentLocale: locale }, { filename: sourcePath });
}

const DECLARATIONS = [
    'getLocalePack', 'formatI18n', 't', 'escapeHtml', 'localizeCategory',
    'createSidebarSectionHeader', 'createSidebarEmptyState', 'createSkillCard', 'renderSkillList',
].map(extractFunction).join('\n');

function bundledSkills() {
    const dir = path.join(__dirname, '..', 'skills');
    return fs.readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => {
            const file = path.join(dir, entry.name, 'SKILL.md');
            if (!fs.existsSync(file)) return null;
            const content = fs.readFileSync(file, 'utf8');
            const frontmatter = (content.match(/^---\r?\n([\s\S]*?)\r?\n---/m) || [, ''])[1];
            const parsed = parseSkillFrontmatter(frontmatter, entry.name);
            return {
                slug: entry.name,
                name: parsed.name,
                description: parsed.description,
                tags: parsed.tags,
                category: parsed.category || 'Skills',
                source: parsed.source || (entry.name.startsWith('hermes-') ? 'hermes-agent' : 'visual-agent'),
            };
        })
        .filter(Boolean)
        .sort((a, b) => a.slug.localeCompare(b.slug));
}

const SKILLS = bundledSkills();
const HERMES = SKILLS.filter((skill) => skill.source === 'hermes-agent');
const CATEGORIES = [...new Set(SKILLS.map((skill) => skill.category))].sort();

function createElement() {
    return { className: '', innerHTML: '', textContent: '', style: {}, dataset: {}, title: '' };
}

function createContext(locale = 'zh-TW', query = '') {
    const container = {
        innerHTML: '',
        children: [],
        appendChild(child) { this.children.push(child); return child; },
    };
    const context = {
        I18N: loadLocalePacks(locale),
        currentLocale: locale,
        skillsList: SKILLS,
        skillListContainer: container,
        skillCount: { textContent: '' },
        recSearchQuery: query,
        document: { createElement },
    };
    vm.createContext(context);
    vm.runInContext(DECLARATIONS, context, { filename: sourcePath });
    return { context, container };
}

const sectionHeaders = (container) => container.children
    .filter((child) => String(child.className).startsWith('sidebar-section-header'))
    .map((child) => child.textContent);
const sourceHeaders = (container) => container.children
    .filter((child) => String(child.className).startsWith('skill-source-header'))
    .map((child) => child.innerHTML);
const cardTitles = (container) => container.children
    .filter((child) => child.className === 'recommend-card skill-card')
    .map((child) => (child.innerHTML.match(/<div class="recommend-title">([^<]*)<\/div>/) || [, ''])[1]);
const hasCjk = (value) => /[\u4e00-\u9fff]/.test(value);

test('the bundled skills still match the premise: 15 categories, 14 of them lowercase Hermes values', () => {
    assert.equal(SKILLS.length, 37);
    assert.equal(HERMES.length, 19);
    assert.equal(CATEGORIES.length, 15);
    assert.deepEqual(CATEGORIES.filter((cat) => cat !== 'Skills'), [
        'ai', 'communication', 'creative', 'data', 'development', 'devops', 'iot',
        'knowledge', 'media', 'meta', 'platform', 'productivity', 'research', 'security',
    ]);
    // 沒有 category 欄位的 skill 由 parseSkillFrontmatter 補成 'Skills'，不是空字串。
    assert.equal(SKILLS.filter((skill) => skill.category === 'Skills').length, 18);
});

test('every bundled skill category resolves to a localized label in both locales', () => {
    for (const locale of ['zh-TW', 'en-US']) {
        const { context } = createContext(locale);
        for (const category of CATEGORIES) {
            const label = context.localizeCategory(category);
            assert.ok(label, `${locale}: "${category}" resolved to an empty label`);
            assert.ok(context.t(`categories.${category}`), `${locale}: categories.${category} is missing`);
            if (locale === 'zh-TW') {
                assert.notEqual(label, category, `zh-TW "${category}" still falls through to the raw value`);
                if (!/^(AI|DevOps)$/.test(label)) {
                    assert.ok(hasCjk(label), `zh-TW "${category}" resolved to "${label}" without Chinese`);
                }
            }
            if (locale === 'en-US') {
                assert.ok(!hasCjk(label), `en-US "${category}" leaked Chinese: "${label}"`);
            }
        }
    }
});

test('the Skills panel renders no raw English category header in zh-TW', () => {
    const { context } = createContext('zh-TW');
    context.renderSkillList();
    const headers = sectionHeaders(context.skillListContainer);
    assert.equal(headers.length, CATEGORIES.length);
    for (const category of CATEGORIES) {
        assert.ok(!headers.includes(category), `zh-TW still shows the raw header "${category}"`);
    }
    assert.ok(headers.includes('技能'), `expected 技能, got ${headers.join(' / ')}`);
    assert.ok(headers.includes('開發'), `expected 開發, got ${headers.join(' / ')}`);
    assert.ok(headers.includes('物聯網'), `expected 物聯網, got ${headers.join(' / ')}`);
});

test('en-US headers are readable Title Case, not the raw lowercase keys', () => {
    const { context } = createContext('en-US');
    context.renderSkillList();
    const headers = sectionHeaders(context.skillListContainer);
    assert.equal(headers.length, CATEGORIES.length);
    assert.ok(headers.includes('Development'));
    assert.ok(headers.includes('DevOps'));
    assert.ok(headers.includes('IoT'));
    assert.ok(headers.includes('Self-Improvement'));
    assert.ok(!headers.includes('development'));
    assert.ok(!headers.includes('devops'));
    assert.ok(!headers.includes('iot'));
    assert.ok(!headers.some(hasCjk), `en-US headers leaked Chinese: ${headers.join(' / ')}`);
});

test('the Hermes source header and badge tooltip follow the active locale', () => {
    const zh = createContext('zh-TW').context;
    zh.renderSkillList();
    const zhSources = sourceHeaders(zh.skillListContainer);
    assert.equal(zhSources.length, 2);
    assert.ok(zhSources[1].includes('來自 Hermes Agent'), zhSources[1]);
    assert.ok(!zhSources[1].includes('From Hermes Agent'), zhSources[1]);
    const zhBadge = zh.createSkillCard(HERMES[0]).innerHTML;
    assert.ok(zhBadge.includes('由 Hermes Agent 轉換而來'), zhBadge);
    assert.ok(!zhBadge.includes('Converted from Hermes Agent'), zhBadge);

    const en = createContext('en-US').context;
    en.renderSkillList();
    const enSources = sourceHeaders(en.skillListContainer);
    assert.ok(enSources[1].includes('From Hermes Agent'), enSources[1]);
    assert.ok(!enSources.some(hasCjk), `en-US source headers leaked Chinese: ${enSources.join(' / ')}`);
    const enBadge = en.createSkillCard(HERMES[0]).innerHTML;
    assert.ok(enBadge.includes('Converted from Hermes Agent'), enBadge);
    assert.ok(!hasCjk(enBadge), 'en-US skill card leaked Chinese');
});

test('a visual-agent skill card carries no Hermes badge in either locale', () => {
    const own = SKILLS.find((skill) => skill.source === 'visual-agent');
    for (const locale of ['zh-TW', 'en-US']) {
        const { context } = createContext(locale);
        const markup = context.createSkillCard(own).innerHTML;
        assert.ok(!markup.includes('skill-source-badge'), `${locale}: ${own.slug} gained a Hermes badge`);
    }
});

test('searching by the localized category finds the skills in that group', () => {
    const zh = createContext('zh-TW', '物聯網').context;
    zh.renderSkillList();
    assert.deepEqual(cardTitles(zh.skillListContainer), ['hermes-smart-home']);
    assert.equal(zh.skillCount.textContent, '1');

    const en = createContext('en-US', 'development').context;
    en.renderSkillList();
    // developer-tools-assistant 的 description 也含 development，搜尋是子字串比對，因此一併命中。
    assert.equal(en.skillCount.textContent, '3');
    assert.deepEqual(cardTitles(en.skillListContainer).sort(), ['developer-tools-assistant', 'hermes-github', 'hermes-software-development']);
});

test('category search does not break name, slug, description or tag search', () => {
    const bySlug = createContext('zh-TW', 'hermes-github').context;
    bySlug.renderSkillList();
    assert.deepEqual(cardTitles(bySlug.skillListContainer), ['hermes-github']);

    const byTag = createContext('zh-TW', 'cicd').context;
    byTag.renderSkillList();
    assert.ok(cardTitles(byTag.skillListContainer).includes('hermes-github'));

    const byName = createContext('en-US', 'ollama').context;
    byName.renderSkillList();
    assert.ok(cardTitles(byName.skillListContainer).includes('ollama'));

    const none = createContext('zh-TW', 'zzzz-no-such-skill').context;
    none.renderSkillList();
    assert.equal(none.skillCount.textContent, '0');
    assert.equal(cardTitles(none.skillListContainer).length, 0);
    assert.ok(none.skillListContainer.children.some((child) => child.className === 'sidebar-empty'));
});

test('an unknown category still falls back to the raw value rather than blanking the header', () => {
    for (const locale of ['zh-TW', 'en-US']) {
        const { context } = createContext(locale);
        assert.equal(context.localizeCategory('Brand New Category'), 'Brand New Category');
        assert.equal(context.localizeCategory(''), locale === 'zh-TW' ? '其他' : 'Other');
        context.skillsList = [{ slug: 'x', name: 'X', description: '', tags: [], category: '', source: 'visual-agent' }];
        context.renderSkillList();
        assert.deepEqual(sectionHeaders(context.skillListContainer), [locale === 'zh-TW' ? '其他' : 'Other']);
    }
});

test('the skill count reflects the filtered list, not the whole library', () => {
    const all = createContext('zh-TW').context;
    all.renderSkillList();
    assert.equal(all.skillCount.textContent, String(SKILLS.length));
    const one = createContext('zh-TW', '物聯網').context;
    one.renderSkillList();
    assert.equal(one.skillCount.textContent, '1');
});
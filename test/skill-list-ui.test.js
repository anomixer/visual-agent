'use strict';
// Skills 側邊欄分組 — 擷取 public/app.js 的真實 renderSkillList / createSkillCard，以最小 fake DOM 執行。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const sourcePath = path.join(__dirname, '..', 'public', 'app.js');
const source = fs.readFileSync(sourcePath, 'utf8');

function extractFunction(name) {
    const pattern = new RegExp(`^function ${name}\\([^)]*\\) \\{[^]*?^\\}\\r?$`, 'gm');
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

function createElement() {
    const element = {
        className: '', textContent: '', style: {}, dataset: {}, children: [],
        appendChild(child) { element.children.push(child); return child; },
    };
    let html = '';
    Object.defineProperty(element, 'innerHTML', {
        get: () => html,
        set(value) { html = value; if (value === '') element.children.length = 0; },
    });
    return element;
}

const NATIVE_SKILL = {
    slug: 'probe-native', name: 'probe-native', description: 'Synthetic native skill.',
    tags: ['install', 'uninstall', 'repair', 'winget', 'sop'], category: 'Skills', source: 'visual-agent',
};
const HERMES_SKILL = {
    slug: 'hermes-probe', name: 'hermes-probe', description: 'Synthetic converted skill.',
    tags: ['apple', 'macos', 'finder', 'screenshots', 'accessibility', 'desktop'],
    category: 'platform', source: 'hermes-agent',
};

function render(skills, { locale = 'zh-TW', query = '' } = {}) {
    const container = createElement();
    const count = createElement();
    const context = {
        I18N: loadLocalePacks(locale),
        currentLocale: locale,
        skillListContainer: container,
        skillCount: count,
        skillsList: skills,
        recSearchQuery: query,
        document: { createElement },
    };
    vm.createContext(context);
    vm.runInContext(DECLARATIONS, context, { filename: sourcePath });
    context.renderSkillList();
    return { container, count, context };
}

const sourceHeaders = (container) => container.children.filter((child) => child.className.startsWith('skill-source-header'));
const sectionHeaders = (container) => container.children.filter((child) => child.className === 'sidebar-section-header');
const cards = (container) => container.children.filter((child) => child.className.includes('skill-card'));

test('skills split into the Visual Agent and From Hermes Agent source groups', () => {
    const { container, count } = render([NATIVE_SKILL, HERMES_SKILL]);
    const headers = sourceHeaders(container);
    assert.equal(headers.length, 2, 'both source groups must render');
    assert.ok(headers[0].innerHTML.includes('Visual Agent'));
    assert.ok(headers[0].innerHTML.includes('>1<'), 'the Visual Agent count must be 1, not the whole library');
    assert.ok(headers[1].className.includes('skill-source-header--hermes'));
    assert.ok(headers[1].innerHTML.includes('來自 Hermes Agent'));
    assert.ok(headers[1].innerHTML.includes('>1<'));
    assert.equal(count.textContent, '2');
    assert.equal(cards(container).length, 2);
});

test('a missing source still lands in the Visual Agent group', () => {
    const { container } = render([{ ...NATIVE_SKILL, source: undefined }, HERMES_SKILL]);
    const headers = sourceHeaders(container);
    assert.equal(headers.length, 2);
    assert.ok(headers[0].innerHTML.includes('>1<'));
});

test('each source group is subdivided by its own category', () => {
    const { container } = render([
        NATIVE_SKILL,
        { ...NATIVE_SKILL, slug: 'probe-native-2', name: 'probe-native-2' },
        HERMES_SKILL,
        { ...HERMES_SKILL, slug: 'hermes-probe-2', name: 'hermes-probe-2', category: 'media' },
    ]);
    assert.deepEqual(sectionHeaders(container).map((header) => header.textContent), ['技能', '平台', '媒體']);
    assert.deepEqual(sourceHeaders(container).map((header) => header.innerHTML.includes('來自 Hermes Agent')), [false, true]);
});

test('the card shows at most four tags and the Hermes badge', () => {
    const { container } = render([NATIVE_SKILL, HERMES_SKILL]);
    const [nativeCard, hermesCard] = cards(container);
    assert.ok(nativeCard.innerHTML.includes('install, uninstall, repair, winget'));
    assert.equal(nativeCard.innerHTML.includes('sop'), false, 'only the first four tags are shown');
    assert.equal(nativeCard.innerHTML.includes('Hermes'), false);
    assert.ok(hermesCard.innerHTML.includes('apple, macos, finder, screenshots'));
    assert.ok(hermesCard.innerHTML.includes('skill-source-badge'));
    assert.ok(hermesCard.innerHTML.includes('⚗️ Hermes'));
});

test('a skill without tags renders no tag badge', () => {
    const { container } = render([{ ...NATIVE_SKILL, tags: [] }]);
    const [card] = cards(container);
    assert.equal(card.innerHTML.includes('recommend-skill-badge'), false);
    assert.ok(card.innerHTML.includes('probe-native'));
});

test('search filters across name, slug, description and tags', () => {
    const skills = [NATIVE_SKILL, HERMES_SKILL];
    assert.equal(cards(render(skills, { query: 'robocopy' }).container).length, 0);
    assert.equal(cards(render(skills, { query: 'winget' }).container).length, 1);
    assert.equal(cards(render(skills, { query: 'macos' }).container).length, 1);
    assert.equal(cards(render(skills, { query: 'hermes-probe' }).container).length, 1);
    const empty = render(skills, { query: 'nothing-matches' });
    assert.equal(cards(empty.container).length, 0);
    assert.equal(empty.count.textContent, '0');
    assert.ok(empty.container.children.some((child) => child.className === 'sidebar-empty'));
});

test('an empty library shows the loading state and re-rendering replaces the nodes', () => {
    const empty = render([]);
    assert.ok(empty.container.innerHTML.includes('sidebar-empty'));
    assert.equal(empty.container.children.length, 0);

    const { container, context } = render([NATIVE_SKILL, HERMES_SKILL]);
    const first = container.children.length;
    assert.ok(first > 0);
    context.renderSkillList();
    assert.equal(container.children.length, first, 'a second render must not accumulate nodes');
    context.skillsList = [];
    context.renderSkillList();
    assert.equal(container.children.length, 0);
    assert.equal(cards(container).length, 0);
});

test('skill names and tags are escaped', () => {
    const { container } = render([{
        ...NATIVE_SKILL,
        slug: '<img src=x onerror=alert(1)>',
        name: '<script>alert(1)</script>',
        tags: ['<b>tag</b>'],
    }]);
    const [card] = cards(container);
    assert.equal(card.innerHTML.includes('<script>'), false);
    assert.equal(card.innerHTML.includes('<img src=x'), false);
    assert.equal(card.innerHTML.includes('<b>tag</b>'), false);
    assert.ok(card.innerHTML.includes('&lt;script&gt;'));
});
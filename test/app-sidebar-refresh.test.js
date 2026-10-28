'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const sourcePath = path.join(__dirname, '..', 'public', 'app.js');
const source = fs.readFileSync(sourcePath, 'utf8');

function extract(pattern, label) {
    const matches = [...source.matchAll(pattern)];
    assert.equal(matches.length, 1, `Expected one actual declaration of ${label}`);
    return new vm.Script(matches[0][0], {
        filename: sourcePath,
        lineOffset: source.slice(0, matches[0].index).split('\n').length - 1,
    });
}

const declarations = [
    extract(/^let lastRecommendSignature = '';\r?$/gm, 'lastRecommendSignature'),
    extract(/^let lastSopSignature = '';\r?$/gm, 'lastSopSignature'),
    extract(/^let lastSkillSignature = '';\r?$/gm, 'lastSkillSignature'),
    extract(/^(?:async )?function loadRecommend\([^]*?^\}\r?$/gm, 'loadRecommend'),
    extract(/^(?:async )?function loadSops\([^]*?^\}\r?$/gm, 'loadSops'),
    extract(/^(?:async )?function loadSkills\([^]*?^\}\r?$/gm, 'loadSkills'),
];

function harness(responses) {
    const renders = [];
    const splashes = [];
    const context = vm.createContext({
        console,
        recommendList: [], sopsList: [], skillsList: [],
        api: async (route) => {
            const response = responses[route];
            if (response instanceof Error) throw response;
            assert.ok(response !== undefined, `Unexpected API route ${route}`);
            return response;
        },
        renderSidebarTab: () => renders.push({
            recommend: context.recommendList,
            sops: context.sopsList,
            skills: context.skillsList,
        }),
        hideSplash: () => splashes.push(true),
    });
    for (const declaration of declarations) declaration.runInContext(context, { timeout: 1000 });
    return { context, renders, splashes };
}

const recommendItem = (overrides = {}) => ({
    id: 'rec_install_chrome',
    title: 'Install Chrome',
    skillId: 'rec_install_chrome',
    installed: false,
    supportsUninstall: true,
    recommendedAction: 'install',
    ...overrides,
});

const sop = (overrides = {}) => ({
    id: 'rec_install_chrome',
    name: 'Install Chrome',
    category: 'Browser',
    installed: false,
    recommendedAction: 'install',
    ...overrides,
});

const skill = (overrides = {}) => ({
    slug: 'browser-research',
    name: 'Browser Research',
    description: 'Research with the browser',
    tags: ['browser'],
    category: 'Skills',
    ...overrides,
});

test('unchanged recommend payload renders the sidebar only once', async () => {
    const { context, renders, splashes } = harness({
        '/api/recommend': {
            success: true,
            recommendList: [recommendItem(), recommendItem({ id: 'rec_install_ollama', title: 'Install Ollama' })],
        },
    });

    await context.loadRecommend();
    await context.loadRecommend();
    await context.loadRecommend();

    assert.equal(renders.length, 1, 'Identical data must not rebuild the sidebar');
    assert.equal(splashes.length, 3, 'Splash must still be hidden on every successful poll');
    assert.equal(context.recommendList.length, 2, 'Latest payload must still replace the cached list');
});

test('changed install state re-renders the sidebar', async () => {
    const { context, renders } = harness({ '/api/recommend': { success: true, recommendList: [recommendItem()] } });

    await context.loadRecommend();
    assert.equal(renders.length, 1);

    context.api = async () => ({
        success: true,
        recommendList: [recommendItem({ installed: true, recommendedAction: 'uninstall' })],
    });
    await context.loadRecommend();
    assert.equal(renders.length, 2, 'Install-state change must reach the sidebar');

    context.api = async () => ({
        success: true,
        recommendList: [recommendItem({ installed: true, recommendedAction: 'uninstall', supportsUninstall: false })],
    });
    await context.loadRecommend();
    assert.equal(renders.length, 3);
});

test('SOP and skill lists follow the same unchanged-payload rule', async () => {
    const { context, renders } = harness({
        '/api/sops': { success: true, sops: [sop()] },
        '/api/skills': { success: true, skills: [skill()] },
    });

    await context.loadSops();
    await context.loadSkills();
    assert.equal(renders.length, 2);

    await context.loadSops();
    await context.loadSkills();
    assert.equal(renders.length, 2, 'Repeated identical SOP and skill payloads must not re-render');

    context.api = async (route) => (route === '/api/sops'
        ? { success: true, sops: [sop({ id: 'rec_install_ollama', name: 'Install Ollama' })] }
        : { success: true, skills: [skill()] });
    await context.loadSops();
    await context.loadSkills();
    assert.equal(renders.length, 3, 'A changed SOP list must re-render exactly once');

    assert.equal(context.sopsList[0].id, 'rec_install_ollama', 'Latest SOP list must still replace the cached list');
});

test('failed or empty responses never render or throw', async () => {
    const { context, renders, splashes } = harness({ '/api/recommend': { success: false } });

    await context.loadRecommend();
    assert.equal(renders.length, 0);
    assert.equal(splashes.length, 0);

    context.api = async () => ({ success: true, recommendList: [] });
    await context.loadRecommend();
    assert.equal(renders.length, 0);

    const broken = harness({ '/api/recommend': new Error('offline') });
    const originalError = console.error;
    console.error = () => {};
    try {
        await broken.context.loadRecommend();
    } finally {
        console.error = originalError;
    }
    assert.equal(broken.renders.length, 0);
    assert.equal(broken.splashes.length, 0);
});

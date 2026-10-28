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
    extract(/^(?:async )?function loadRecommend\([^]*?^\}\r?$/gm, 'loadRecommend'),
];

function harness(payload) {
    const renders = [];
    const splashes = [];
    const context = vm.createContext({
        console,
        recommendList: [],
        api: async (route) => {
            assert.equal(route, '/api/recommend');
            if (payload instanceof Error) throw payload;
            return payload;
        },
        renderSidebarTab: () => renders.push(context.recommendList),
        hideSplash: () => splashes.push(true),
    });
    for (const declaration of declarations) declaration.runInContext(context, { timeout: 1000 });
    return { context, renders, splashes };
}

const item = (overrides = {}) => ({
    id: 'rec_install_chrome',
    title: 'Install Chrome',
    skillId: 'rec_install_chrome',
    installed: false,
    supportsUninstall: true,
    recommendedAction: 'install',
    ...overrides,
});

test('unchanged recommend payload renders the sidebar only once', async () => {
    const { context, renders, splashes } = harness({
        success: true,
        recommendList: [item(), item({ id: 'rec_install_ollama', title: 'Install Ollama' })],
    });

    await context.loadRecommend();
    await context.loadRecommend();
    await context.loadRecommend();

    assert.equal(renders.length, 1, 'Polling with identical data must not rebuild the sidebar');
    assert.equal(splashes.length, 3, 'Splash must still be hidden on every successful poll');
    assert.equal(context.recommendList.length, 2, 'Latest payload must still replace the cached list');
});

test('changed install state re-renders the sidebar', async () => {
    const { context, renders } = harness({ success: true, recommendList: [item()] });

    await context.loadRecommend();
    assert.equal(renders.length, 1);

    const installedPayload = {
        success: true,
        recommendList: [item({ installed: true, recommendedAction: 'uninstall' })],
    };
    context.api = async () => installedPayload;
    await context.loadRecommend();
    assert.equal(renders.length, 2, 'Install-state change must reach the sidebar');

    context.api = async () => ({ success: true, recommendList: [item({ installed: true, recommendedAction: 'uninstall', supportsUninstall: false })] });
    await context.loadRecommend();
    assert.equal(renders.length, 3);
});

test('failed or empty responses never render or throw', async () => {
    const { context, renders, splashes } = harness({ success: false });

    await context.loadRecommend();
    assert.equal(renders.length, 0);
    assert.equal(splashes.length, 0);

    context.api = async () => ({ success: true, recommendList: [] });
    await context.loadRecommend();
    assert.equal(renders.length, 0);

    const broken = harness(new Error('offline'));
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

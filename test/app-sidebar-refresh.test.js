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
    extract(/^let recommendRequestSeq = 0;\r?$/gm, 'recommendRequestSeq'),
    extract(/^let sopRequestSeq = 0;\r?$/gm, 'sopRequestSeq'),
    extract(/^let skillRequestSeq = 0;\r?$/gm, 'skillRequestSeq'),
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
            const response = typeof responses === 'function' ? responses(route) : responses[route];
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

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

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

test('an older recommend response cannot overwrite a newer snapshot', async () => {
    const older = deferred();
    const newer = deferred();
    let requests = 0;
    const { context, renders, splashes } = harness(() => (++requests === 1 ? older.promise : newer.promise));

    const olderLoad = context.loadRecommend();
    const newerLoad = context.loadRecommend();
    newer.resolve({ success: true, recommendList: [recommendItem({ id: 'new-recommendation' })] });
    await newerLoad;
    older.resolve({ success: true, recommendList: [recommendItem({ id: 'old-recommendation' })] });
    await olderLoad;

    assert.deepEqual(context.recommendList.map((item) => item.id), ['new-recommendation']);
    assert.equal(renders.length, 1, 'The stale response must not trigger a second render');
    assert.equal(splashes.length, 1, 'The stale response must not repeat successful-load side effects');
});

test('an older SOP response cannot remove a newly loaded SOP', async () => {
    const older = deferred();
    const newer = deferred();
    let requests = 0;
    const { context, renders } = harness(() => (++requests === 1 ? older.promise : newer.promise));

    const olderLoad = context.loadSops();
    const newerLoad = context.loadSops();
    newer.resolve({ success: true, sops: [sop({ id: 'old-sop' }), sop({ id: 'new-sop', name: 'New SOP' })] });
    await newerLoad;
    older.resolve({ success: true, sops: [sop({ id: 'old-sop' })] });
    await olderLoad;

    assert.deepEqual(context.sopsList.map((item) => item.id), ['old-sop', 'new-sop']);
    assert.equal(renders.length, 1);
});

test('an older skill response cannot remove a newly loaded skill', async () => {
    const older = deferred();
    const newer = deferred();
    let requests = 0;
    const { context, renders } = harness(() => (++requests === 1 ? older.promise : newer.promise));

    const olderLoad = context.loadSkills();
    const newerLoad = context.loadSkills();
    newer.resolve({ success: true, skills: [skill(), skill({ slug: 'new-skill', name: 'New Skill' })] });
    await newerLoad;
    older.resolve({ success: true, skills: [skill()] });
    await olderLoad;

    assert.deepEqual(context.skillsList.map((item) => item.slug), ['browser-research', 'new-skill']);
    assert.equal(renders.length, 1);
});

test('the latest sidebar failure suppresses an older successful response', async () => {
    const older = deferred();
    let requests = 0;
    const { context, renders } = harness(() => (++requests === 1 ? older.promise : Promise.reject(new Error('offline'))));
    const originalError = console.error;
    const errors = [];
    console.error = (...args) => errors.push(args);
    try {
        const olderLoad = context.loadSops();
        await context.loadSops();
        older.resolve({ success: true, sops: [sop()] });
        await olderLoad;
    } finally {
        console.error = originalError;
    }

    assert.deepEqual(context.sopsList, []);
    assert.equal(renders.length, 0);
    assert.equal(errors.length, 1, 'Only the latest failure should be logged');
});

test('stale sidebar rejections cannot log errors or disturb newer successes', async () => {
    const cases = [
        {
            load: 'loadRecommend',
            response: { success: true, recommendList: [recommendItem()] },
            list: 'recommendList',
            id: 'id',
            expected: 'rec_install_chrome',
        },
        {
            load: 'loadSops',
            response: { success: true, sops: [sop()] },
            list: 'sopsList',
            id: 'id',
            expected: 'rec_install_chrome',
        },
        {
            load: 'loadSkills',
            response: { success: true, skills: [skill()] },
            list: 'skillsList',
            id: 'slug',
            expected: 'browser-research',
        },
    ];

    for (const fixture of cases) {
        const older = deferred();
        let requests = 0;
        const { context, renders } = harness(() => (++requests === 1 ? older.promise : Promise.resolve(fixture.response)));
        const originalError = console.error;
        const errors = [];
        console.error = (...args) => errors.push(args);
        try {
            const olderLoad = context[fixture.load]();
            await context[fixture.load]();
            older.reject(new Error('stale offline'));
            await olderLoad;
        } finally {
            console.error = originalError;
        }

        assert.equal(context[fixture.list][0][fixture.id], fixture.expected);
        assert.equal(renders.length, 1);
        assert.deepEqual(errors, [], `${fixture.load} must suppress stale rejection logs`);
    }
});

test('recommend, SOP, and skill request ordering is independent', async () => {
    const recommend = deferred();
    const sops = deferred();
    const skills = deferred();
    const { context, renders } = harness((route) => ({
        '/api/recommend': recommend.promise,
        '/api/sops': sops.promise,
        '/api/skills': skills.promise,
    })[route]);

    const pending = [context.loadRecommend(), context.loadSops(), context.loadSkills()];
    skills.resolve({ success: true, skills: [skill()] });
    sops.resolve({ success: true, sops: [sop()] });
    recommend.resolve({ success: true, recommendList: [recommendItem()] });
    await Promise.all(pending);

    assert.equal(context.recommendList.length, 1);
    assert.equal(context.sopsList.length, 1);
    assert.equal(context.skillsList.length, 1);
    assert.equal(renders.length, 3);
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

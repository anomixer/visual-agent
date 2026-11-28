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
    extract(/^function getActiveRemoteSession\([^]*?^\}\r?$/gm, 'getActiveRemoteSession'),
    extract(/^function pruneRemovedRemoteChalkboardSessions\([^]*?^\}\r?$/gm, 'pruneRemovedRemoteChalkboardSessions'),
    extract(/^async function loadRemoteProfileAndState\([^]*?^\}\r?$/gm, 'loadRemoteProfileAndState'),
];

function harness() {
    const routes = [];
    const pending = [];
    const renders = [];
    const popupRenders = [];
    const openedTabs = [];
    const synced = [];
    const bubbles = [];
    const storedSelections = [];
    const initialProfile = { agentName: 'Initial Agent', userName: 'Initial User' };
    const context = {
        console: { error: () => {}, warn: () => {}, log: () => {} },
        lastRemoteStateTick: 1,
        remoteStateRequestSeq: 0,
        remoteState: { success: true, tick: 1, profile: initialProfile, sessions: [] },
        remoteProfile: initialProfile,
        remoteProfileDirty: false,
        selectedRemoteSessionId: '',
        activeChatMode: 'remote',
        remoteAgentNameInput: null,
        remoteUserNameInput: null,
        remoteChatMessages: {},
        chatMessages: {},
        notifiedRemoteDisconnectSessionIds: new Set(),
        remoteSessionsOpenedOnChalkboard: new Set(),
        appliedRemoteChalkboardRevisions: new Map(),
        remoteChalkboardLoadTokens: new Map(),
        loadingRemoteChalkboardMessageIds: new Map(),
        appliedRemoteChalkboardMessageIds: new Map(),
        queuedRemoteChalkboardMessage: null,
        remoteChalkboardApplyTimer: null,
        chalkboardState: { hasUserContent: false },
        t: (key) => key,
        api: (route) => {
            routes.push(route);
            return new Promise((resolve) => pending.push(resolve));
        },
        isRemoteProfileEditing: () => false,
        syncRemoteProfileDirty: () => {},
        appendChatBubble: (...args) => bubbles.push(args),
        renderRemotePopup: () => popupRenders.push(context.remoteState.tick),
        openTab: (tab) => openedTabs.push(tab),
        scheduleRemoteChalkboardSync: (force) => synced.push(force),
        localStorage: {
            setItem(key, value) {
                if (key === 'selected_remote_session_id') storedSelections.push(value);
            },
        },
    };
    context.renderRemoteSessionControls = () => {
        renders.push(context.remoteState.tick);
        const sessions = context.remoteState.sessions || [];
        if (context.selectedRemoteSessionId && !sessions.some((item) => item.id === context.selectedRemoteSessionId)) {
            context.selectedRemoteSessionId = '';
        }
        if (!context.selectedRemoteSessionId) {
            context.selectedRemoteSessionId = sessions.find((item) => item.status === 'active')?.id
                || sessions[0]?.id || '';
        }
        context.localStorage.setItem('selected_remote_session_id', context.selectedRemoteSessionId);
    };
    vm.createContext(context);
    for (const declaration of declarations) declaration.runInContext(context, { timeout: 1000 });

    async function resolveAt(index, payload) {
        assert.ok(pending[index], `Expected pending remote-state request ${index}`);
        pending[index](payload);
        await new Promise((resolve) => setImmediate(resolve));
    }

    return {
        context, routes, renders, popupRenders, openedTabs, synced, bubbles,
        storedSelections, resolveAt,
    };
}

function state(tick, userName, sessions = []) {
    return {
        success: true,
        tick,
        profile: { agentName: `${userName} Agent`, userName },
        sessions,
    };
}

test('an older full response cannot overwrite newer sessions or selection', async () => {
    const fixture = harness();
    const { context, routes, resolveAt } = fixture;

    const older = context.loadRemoteProfileAndState();
    const newer = context.loadRemoteProfileAndState();
    assert.deepEqual(routes, ['/api/remote/state?since=1', '/api/remote/state?since=1']);

    await resolveAt(1, state(3, 'New User', [{ id: 'new-session', status: 'active' }]));
    await newer;
    assert.equal(context.selectedRemoteSessionId, 'new-session');

    await resolveAt(0, state(2, 'Old User'));
    await older;

    assert.equal(context.lastRemoteStateTick, 3, 'the cursor must not move backwards');
    assert.equal(context.remoteState.profile.userName, 'New User', 'the newer profile must remain visible');
    assert.equal(context.remoteState.sessions[0]?.id, 'new-session', 'the newer session list must remain visible');
    assert.equal(context.selectedRemoteSessionId, 'new-session', 'the current selection must not be cleared by stale state');
});

test('an older active snapshot cannot revive a disconnected session or trigger chalkboard work', async () => {
    const fixture = harness();
    const { context, resolveAt, openedTabs, synced } = fixture;
    context.selectedRemoteSessionId = 'shared-session';
    context.chalkboardState.hasUserContent = true;

    const older = context.loadRemoteProfileAndState();
    const newer = context.loadRemoteProfileAndState();
    await resolveAt(1, state(3, 'New User', [{ id: 'shared-session', status: 'disconnected' }]));
    await newer;
    assert.deepEqual(openedTabs, []);
    assert.deepEqual(synced, []);

    await resolveAt(0, state(2, 'Old User', [{
        id: 'shared-session', status: 'active', direction: 'outgoing',
    }]));
    await older;

    assert.equal(context.remoteState.sessions[0].status, 'disconnected', 'a stale snapshot must not revive the peer');
    assert.equal(context.lastRemoteStateTick, 3);
    assert.deepEqual(openedTabs, [], 'stale state must not switch the workspace');
    assert.deepEqual(synced, [], 'stale state must not schedule a screen sync');
});

test('an older unchanged response cannot rewind the polling cursor', async () => {
    const fixture = harness();
    const { context, resolveAt, renders } = fixture;

    const older = context.loadRemoteProfileAndState();
    const newer = context.loadRemoteProfileAndState();
    await resolveAt(1, state(4, 'New User'));
    await newer;
    const renderCount = renders.length;

    await resolveAt(0, { success: true, tick: 3, unchanged: true });
    await older;

    assert.equal(context.lastRemoteStateTick, 4, 'an unchanged response is still ordered');
    assert.equal(renders.length, renderCount, 'stale unchanged responses must not cause a render');
});

test('a newer response with a lower tick is accepted after a backend restart', async () => {
    const fixture = harness();
    const { context, resolveAt } = fixture;
    context.lastRemoteStateTick = 9;

    const older = context.loadRemoteProfileAndState();
    const newer = context.loadRemoteProfileAndState();
    await resolveAt(1, state(1, 'Restarted User'));
    await newer;
    assert.equal(context.lastRemoteStateTick, 1);

    await resolveAt(0, state(8, 'Previous Process'));
    await older;

    assert.equal(context.lastRemoteStateTick, 1, 'request order must not be confused with a server restart');
    assert.equal(context.remoteState.profile.userName, 'Restarted User');
});

test('a failed newer request does not allow an older success to apply', async () => {
    const fixture = harness();
    const { context, routes, resolveAt, renders } = fixture;

    const older = context.loadRemoteProfileAndState();
    const newer = context.loadRemoteProfileAndState();
    await resolveAt(1, { success: false, error: 'offline' });
    await newer;
    await resolveAt(0, state(2, 'Late User'));
    await older;

    assert.equal(context.lastRemoteStateTick, 1);
    assert.equal(context.remoteState.profile.userName, 'Initial User');
    assert.equal(renders.length, 0);

    const retry = context.loadRemoteProfileAndState();
    assert.equal(routes[2], '/api/remote/state?since=1');
    await resolveAt(2, { success: true, tick: 1, unchanged: true });
    await retry;
});

test('sequential full and unchanged replies still update the cursor without rerendering', async () => {
    const fixture = harness();
    const { context, routes, resolveAt, renders } = fixture;

    const full = context.loadRemoteProfileAndState();
    await resolveAt(0, state(2, 'Current User'));
    await full;
    assert.equal(renders.length, 1);

    const unchanged = context.loadRemoteProfileAndState();
    assert.equal(routes[1], '/api/remote/state?since=2');
    await resolveAt(1, { success: true, tick: 2, unchanged: true });
    await unchanged;
    assert.equal(context.lastRemoteStateTick, 2);
    assert.equal(renders.length, 1);
});

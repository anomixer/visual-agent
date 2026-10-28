'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { OAuthTokenCache } = require(path.join(__dirname, '..', 'src', 'oauth-token-cache.js'));

(async () => {
    let now = 100000;
    const requestedBodies = [];
    const cache = new OAuthTokenCache({
        now: () => now,
        fetchImpl: async (_url, options) => {
            requestedBodies.push(new URLSearchParams(options.body));
            const index = requestedBodies.length;
            return {
                ok: true,
                json: async () => ({ access_token: `token-${index}`, expires_in: 3600 }),
            };
        },
    });
    const configA = { tokenUrl: 'https://auth.example/token', clientId: 'a', clientSecret: 'secret-a', scope: 'one', audience: 'api-a' };
    const configB = { ...configA, clientId: 'b', clientSecret: 'secret-b', scope: 'two', audience: 'api-b' };

    assert.equal(await cache.getToken(configA), 'token-1');
    assert.equal(await cache.getToken(configA), 'token-1');
    assert.equal(await cache.getToken(configB), 'token-2');
    assert.equal(requestedBodies.length, 2);
    assert.equal(requestedBodies[0].get('client_id'), 'a');
    assert.equal(requestedBodies[1].get('client_id'), 'b');

    assert.equal(await cache.getToken({ ...configA, clientSecret: 'rotated' }), 'token-3');
    now += 3600 * 1000;
    assert.equal(await cache.getToken(configB), 'token-4');
    cache.clear();
    assert.equal(await cache.getToken(configA), 'token-5');

    console.log('\n[oauth-token-cache.test] 5 passed');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});

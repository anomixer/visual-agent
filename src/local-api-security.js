'use strict';

const crypto = require('node:crypto');

const DEFAULT_TRUSTED_HOSTS = [
    'localhost:3210',
    '127.0.0.1:3210',
];

const DEFAULT_TRUSTED_ORIGINS = [
    'http://localhost:3210',
    'http://127.0.0.1:3210',
    'http://tauri.localhost',
    'https://tauri.localhost',
    'tauri://localhost',
];

function tokensEqual(actual, expected) {
    const left = Buffer.from(String(actual || ''));
    const right = Buffer.from(String(expected || ''));
    return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

function createLocalApiSecurity(options = {}) {
    const token = options.token || crypto.randomBytes(32).toString('base64url');
    const trustedHosts = new Set((options.trustedHosts || DEFAULT_TRUSTED_HOSTS).map((value) => String(value).toLowerCase()));
    const trustedOrigins = new Set(options.trustedOrigins || DEFAULT_TRUSTED_ORIGINS);

    function middleware(req, res, next) {
        const host = String(req.headers?.host || '').trim().toLowerCase();
        if (!trustedHosts.has(host)) {
            res.status(403).json({ success: false, error: 'Untrusted Host header' });
            return;
        }

        const origin = String(req.headers?.origin || '').trim();
        const fetchSite = String(req.headers?.['sec-fetch-site'] || '').trim().toLowerCase();
        if ((origin && !trustedOrigins.has(origin)) || (!origin && ['cross-site', 'same-site'].includes(fetchSite))) {
            res.status(403).json({ success: false, error: 'Untrusted request origin' });
            return;
        }

        res.setHeader('Vary', 'Origin');
        if (origin) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, X-Visual-Agent-Token');
            res.setHeader('Access-Control-Max-Age', '600');
        }

        if (req.method === 'OPTIONS') {
            if (!origin) {
                res.status(403).json({ success: false, error: 'Origin is required for preflight requests' });
                return;
            }
            res.sendStatus(204);
            return;
        }

        const requestPath = String(req.path || req.url || '').split('?')[0];
        if (requestPath.startsWith('/api/') && requestPath !== '/api/meta') {
            if (!tokensEqual(req.headers?.['x-visual-agent-token'], token)) {
                res.status(401).json({ success: false, error: 'Local API token required' });
                return;
            }
        }

        next();
    }

    return { middleware, token };
}

module.exports = {
    DEFAULT_TRUSTED_HOSTS,
    DEFAULT_TRUSTED_ORIGINS,
    createLocalApiSecurity,
};

'use strict';

class OAuthTokenCache {
    constructor({ fetchImpl = fetch, now = () => Date.now(), timeoutMs = 10000 } = {}) {
        this.fetchImpl = fetchImpl;
        this.now = now;
        this.timeoutMs = timeoutMs;
        this.entries = new Map();
    }

    clear() {
        this.entries.clear();
    }

    async getToken(authConfig) {
        const cacheKey = JSON.stringify([
            authConfig.tokenUrl || '',
            authConfig.clientId || '',
            authConfig.clientSecret || '',
            authConfig.scope || '',
            authConfig.audience || '',
        ]);
        const cached = this.entries.get(cacheKey);
        if (cached && cached.expiresAt > this.now() + 10000) return cached.token;

        const form = new URLSearchParams();
        form.set('grant_type', 'client_credentials');
        form.set('client_id', authConfig.clientId || '');
        form.set('client_secret', authConfig.clientSecret || '');
        if (authConfig.scope) form.set('scope', authConfig.scope);
        if (authConfig.audience) form.set('audience', authConfig.audience);

        const res = await this.fetchImpl(authConfig.tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: form.toString(),
            signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`OAuth token acquisition failed (${res.status}): ${errText.substring(0, 200)}`);
        }

        const data = await res.json();
        if (!data.access_token) throw new Error('OAuth response missing access_token');
        const expiresIn = Number(data.expires_in || 3600);
        const token = String(data.access_token);
        this.entries.set(cacheKey, {
            token,
            expiresAt: this.now() + ((Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000),
        });
        return token;
    }
}

module.exports = { OAuthTokenCache };

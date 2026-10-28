'use strict';

const dns = require('node:dns');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');

function ipv4Number(ip) {
    const parts = ip.split('.').map(Number);
    return parts.reduce((value, part) => (value * 256) + part, 0);
}

function inIpv4Range(value, base, prefix) {
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return ((value & mask) >>> 0) === ((ipv4Number(base) & mask) >>> 0);
}

function isDisallowedIp(ip = '') {
    let normalized = String(ip || '').trim().toLowerCase();
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) normalized = mapped[1];
    if (net.isIP(normalized) === 4) {
        const value = ipv4Number(normalized);
        return [
            ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
            ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
            ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
            ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
        ].some(([base, prefix]) => inIpv4Range(value, base, prefix));
    }
    if (net.isIP(normalized) === 6) {
        return normalized === '::'
            || normalized === '::1'
            || /^f[cd][0-9a-f]{2}:/.test(normalized)
            || /^fe[89ab][0-9a-f]:/.test(normalized)
            || /^ff[0-9a-f]{2}:/.test(normalized)
            || /^2001:0?db8:/.test(normalized);
    }
    return true;
}

function parsePublicHttpUrl(input = '') {
    let url;
    try {
        url = new URL(String(input || ''));
    } catch {
        throw new Error('Invalid URL');
    }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP(S) URLs are allowed');
    if (url.username || url.password) throw new Error('URLs containing credentials are not allowed');
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(hostname) && isDisallowedIp(hostname)) throw new Error('Private or non-routable network addresses are blocked');
    return url;
}

async function resolvePublicAddress(url, lookup = dns.promises.lookup) {
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(hostname)) return { address: hostname, family: net.isIP(hostname) };
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (!Array.isArray(addresses) || addresses.length === 0) throw new Error('DNS lookup returned no addresses');
    if (addresses.some((item) => isDisallowedIp(item.address))) {
        throw new Error('Hostname resolves to a private or non-routable network address');
    }
    return addresses[0];
}

function readResponse(response, maxBytes) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
            size += chunk.length;
            if (size > maxBytes) {
                reject(new Error(`Response exceeded the ${maxBytes}-byte limit`));
                response.destroy();
                return;
            }
            chunks.push(chunk);
        });
        response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        response.on('error', reject);
    });
}

async function safeFetchText(input, options = {}) {
    const maxBytes = Number(options.maxBytes) || 1024 * 1024;
    const maxRedirects = Number.isFinite(options.maxRedirects) ? options.maxRedirects : 5;
    const timeoutMs = Number(options.timeoutMs) || 25000;
    const lookup = options.lookup || dns.promises.lookup;
    const deadline = Date.now() + timeoutMs;
    let currentUrl = parsePublicHttpUrl(input);

    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
        const resolved = await resolvePublicAddress(currentUrl, lookup);
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) throw new Error('Request timed out');
        const transport = currentUrl.protocol === 'https:' ? https : http;
        const result = await new Promise((resolve, reject) => {
            const request = transport.request(currentUrl, {
                method: 'GET',
                headers: {
                    'User-Agent': 'visual-agent/safe-fetch',
                    'Accept-Encoding': 'identity',
                    ...(options.headers || {}),
                },
                servername: currentUrl.hostname,
                lookup: (hostname, lookupOptions, callback) => callback(null, resolved.address, resolved.family),
            }, async (response) => {
                try {
                    const status = Number(response.statusCode) || 0;
                    const location = response.headers.location;
                    if ([301, 302, 303, 307, 308].includes(status) && location) {
                        response.resume();
                        resolve({ redirect: new URL(location, currentUrl).toString() });
                        return;
                    }
                    const contentLength = Number(response.headers['content-length']) || 0;
                    if (contentLength > maxBytes) {
                        response.resume();
                        reject(new Error(`Response exceeded the ${maxBytes}-byte limit`));
                        return;
                    }
                    const text = await readResponse(response, maxBytes);
                    resolve({
                        ok: status >= 200 && status < 300,
                        status,
                        url: currentUrl.toString(),
                        headers: response.headers,
                        text,
                    });
                } catch (error) {
                    reject(error);
                }
            });
            const timer = setTimeout(() => request.destroy(new Error('Request timed out')), remainingMs);
            request.on('error', (error) => {
                clearTimeout(timer);
                reject(error);
            });
            request.on('close', () => clearTimeout(timer));
            if (options.signal) {
                const abort = () => request.destroy(new Error('Request aborted'));
                if (options.signal.aborted) abort();
                else options.signal.addEventListener('abort', abort, { once: true });
                request.on('close', () => options.signal.removeEventListener('abort', abort));
            }
            request.end();
        });

        if (!result.redirect) return result;
        if (redirectCount === maxRedirects) throw new Error('Too many redirects');
        currentUrl = parsePublicHttpUrl(result.redirect);
    }
    throw new Error('Too many redirects');
}

module.exports = { isDisallowedIp, parsePublicHttpUrl, safeFetchText };

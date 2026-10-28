'use strict';

(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.VisualAgentUiSecurity = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const MAX_IMAGE_DATA_URL_LENGTH = 16 * 1024 * 1024;

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function sanitizeMarkdownHtml(html, purifier) {
        const source = String(html ?? '');
        try {
            if (purifier && typeof purifier.sanitize === 'function') {
                return purifier.sanitize(source);
            }
        } catch {
            // Fall through to escaped text if sanitization fails.
        }
        return escapeHtml(source).replace(/\r?\n/g, '<br>');
    }

    function normalizeImageDataUrl(value) {
        const source = String(value ?? '');
        if (!source || source.length > MAX_IMAGE_DATA_URL_LENGTH) return '';
        const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(source);
        if (!match || match[2].length % 4 !== 0) return '';

        let signature;
        try {
            signature = atob(match[2].slice(0, 16));
        } catch {
            return '';
        }
        const bytes = Array.from(signature, (char) => char.charCodeAt(0));
        const isPng = match[1] === 'png'
            && bytes.length >= 8
            && bytes.slice(0, 8).every((byte, index) => byte === [137, 80, 78, 71, 13, 10, 26, 10][index]);
        const isJpeg = match[1] === 'jpeg'
            && bytes.length >= 3
            && bytes[0] === 0xff
            && bytes[1] === 0xd8
            && bytes[2] === 0xff;
        return isPng || isJpeg ? source : '';
    }

    return { escapeHtml, sanitizeMarkdownHtml, normalizeImageDataUrl, MAX_IMAGE_DATA_URL_LENGTH };
});

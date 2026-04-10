// AI PC Agent Plugin File v1

/**
 * Browser runtime status plugin.
 * Reports whether the local Playwright Chromium cache exists.
 */
const fs = require('fs');
const path = require('path');

module.exports = async function (health) {
    const appData = process.env.APPDATA || '';
    const browserDir = path.join(appData, 'aipc-agent', 'playwright-browsers');
    const exists = fs.existsSync(browserDir);
    const hasFiles = exists ? fs.readdirSync(browserDir).length > 0 : false;

    health.browser = {
        runtime: 'playwright-chromium',
        installed: Boolean(exists && hasFiles),
        path: browserDir,
    };
};

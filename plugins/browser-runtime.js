// Visual Agent Plugin File v1

/**
 * Browser runtime status plugin.
 * Reports whether the local Playwright Chromium cache exists.
 */
const fs = require('fs');
const path = require('path');

module.exports = async function (health) {
    const appData = process.env.APPDATA || '';
    const browserDir = path.join(appData, 'visual-agent', 'playwright-browsers');
    const exists = fs.existsSync(browserDir);
    const hasFiles = exists ? fs.readdirSync(browserDir).length > 0 : false;

    health.browser = {
        runtime: 'playwright-chromium',
        installed: Boolean(exists && hasFiles),
        path: browserDir,
    };
};

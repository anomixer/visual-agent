const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * 系統監控核心 (插件化架構)
 * 負責掃描 plugins/ 目錄下的 .js 檔案並執行它們
 */
async function getSystemHealth() {
    const health = {
        cpu: { load: 0, temp: null, cores: os.cpus().length, model: os.cpus()[0].model },
        ram: { total: os.totalmem(), free: os.freemem(), usage: 0 },
        gpu: { name: 'N/A', load: 0, temp: null, details: null },
        disk: { status: 'OK', drives: [], volumes: [] },
        uptime: os.uptime(),
        timestamp: new Date().toISOString()
    };

    // 1. 預設計算 RAM 使用率
    health.ram.usage = Math.round(((health.ram.total - health.ram.free) / health.ram.total) * 100);

    // 2. 插件加載路徑
    // 優先順序：1. AppData 目錄 (使用者自訂), 2. 程式根目錄 (開發/內建)
    const appDataDir = process.env.APPDATA || (os.platform() === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : path.join(os.homedir(), '.config'));
    const userPluginsDir = path.join(appDataDir, 'aipc-agent', 'plugins');
    const rootPluginsDir = path.join(__dirname, '../plugins');

    const scanDirs = [userPluginsDir, rootPluginsDir];

    for (const dir of scanDirs) {
        if (fs.existsSync(dir)) {
            const files = fs.readdirSync(dir)
                .filter(f => f.endsWith('.js'))
                .sort();

            for (const file of files) {
                try {
                    const pluginPath = path.resolve(dir, file);
                    // 清除緩存以便開發時即時生效
                    delete require.cache[require.resolve(pluginPath)];
                    
                    const plugin = require(pluginPath);
                    if (typeof plugin === 'function') {
                        await plugin(health);
                    }
                } catch (e) {
                    // 即使單一插件失敗，也不要讓整個監控崩潰
                    console.error(`[System Monitor] Plugin ${file} execution failed:`, e.message);
                }
            }
        }
    }

    return health;
}

module.exports = { getSystemHealth };

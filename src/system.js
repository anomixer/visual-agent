const fs = require('fs');
const path = require('path');
const os = require('os');

// 需要的插件先跑：temperature-monitor 以 nvidia-smi 取得 GPU 負載後，
// hardware-info 就不必再花數秒跑 Get-Counter fallback。
const PLUGIN_ORDER = ['temperature-monitor.js', 'hardware-info.js'];

const inFlightProbes = new Map();

function sortPluginFiles(files = []) {
    const rank = (name) => {
        const index = PLUGIN_ORDER.indexOf(name);
        return index === -1 ? PLUGIN_ORDER.length : index;
    };
    return files.slice().sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/**
 * 系統監控核心 (插件化架構)
 * 負責掃描 plugins/ 目錄下的 .js 檔案並執行它們
 */
function getSystemHealth(options = {}) {
    // 探測本身可能跑數秒，但前端每 5 秒輪詢；重疊的呼叫共用同一次探測，避免子程序堆疊。
    const key = Array.isArray(options.pluginDirs) ? options.pluginDirs.join('|') : 'default';
    if (!inFlightProbes.has(key)) {
        const probe = collectSystemHealth(options).finally(() => inFlightProbes.delete(key));
        inFlightProbes.set(key, probe);
    }
    return inFlightProbes.get(key);
}

async function collectSystemHealth(options = {}) {
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
    const userPluginsDir = path.join(appDataDir, 'visual-agent', 'plugins');
    const rootPluginsDir = path.join(__dirname, '../plugins');

    const scanDirs = Array.isArray(options.pluginDirs) ? options.pluginDirs : [userPluginsDir, rootPluginsDir];
    const executedPlugins = new Set();

    for (const dir of scanDirs) {
        if (fs.existsSync(dir)) {
            const files = sortPluginFiles(fs.readdirSync(dir)
                .filter(f => f.endsWith('.js')));

            for (const file of files) {
                // 使用者自訂版本已執行過就跳過同名的內建副本，避免重複探測。
                if (executedPlugins.has(file)) continue;
                executedPlugins.add(file);
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

module.exports = { getSystemHealth, sortPluginFiles };

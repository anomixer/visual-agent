/**
 * @name TemperatureMonitor
 * @description 溫度監控插件，負責偵測 GPU (Nvidia) 與 CPU 的即時溫度變化。
 * @author AI PC Agent Team
 * @version 2026.03.17
 */

const { exec } = require('child_process');

/**
 * 溫度監控插件 (CPU/GPU)
 * @param {Object} health - 共享的系統健康物件
 */
module.exports = async function(health) {
    // 嘗試獲取 GPU 溫度 (Nvidia 優先)
    const gpuTempCmd = `nvidia-smi --query-gpu=temperature.gpu --format=csv,noheader,nounits`;
    
    // 嘗試獲取 CPU 溫度 (這在沒管理員權限下通常會失敗)
    const cpuTempCmd = `powershell -Command "Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue | Select-Object -ExpandProperty CurrentTemperature"`;

    const getGpuTemp = new Promise((resolve) => {
        exec(gpuTempCmd, (err, stdout) => {
            if (!err && stdout) {
                const temp = parseInt(stdout.trim());
                if (!isNaN(temp)) {
                    health.gpu.temp = temp;
                }
            }
            resolve();
        });
    });

    await getGpuTemp;
};

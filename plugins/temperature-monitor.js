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
    // 嘗試獲取 Nvidia GPU 詳細資訊
    const gpuInfoCmd = `nvidia-smi --query-gpu=name,driver_version,temperature.gpu,utilization.gpu,memory.total,memory.used,memory.free,power.draw,power.limit --format=csv,noheader,nounits`;
    
    // 嘗試獲取 CPU 溫度 (這在沒管理員權限下通常會失敗)
    const cpuTempCmd = `powershell -Command "Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue | Select-Object -ExpandProperty CurrentTemperature"`;

    const getGpuInfo = new Promise((resolve) => {
        exec(gpuInfoCmd, (err, stdout) => {
            if (!err && stdout) {
                const firstLine = stdout.trim().split(/\r?\n/)[0];
                const parts = firstLine.split(',').map(s => s.trim());
                if (parts.length >= 9) {
                    const [
                        name,
                        driverVersion,
                        tempRaw,
                        utilizationRaw,
                        memoryTotalRaw,
                        memoryUsedRaw,
                        memoryFreeRaw,
                        powerDrawRaw,
                        powerLimitRaw
                    ] = parts;

                    const temp = parseInt(tempRaw, 10);
                    const utilization = parseInt(utilizationRaw, 10);

                    health.gpu.name = name || health.gpu.name;
                    health.gpu.temp = Number.isFinite(temp) ? temp : health.gpu.temp;
                    health.gpu.load = Number.isFinite(utilization) ? utilization : health.gpu.load;
                    health.gpu.details = {
                        vendor: 'NVIDIA',
                        driverVersion,
                        memoryTotalMB: Number(memoryTotalRaw) || 0,
                        memoryUsedMB: Number(memoryUsedRaw) || 0,
                        memoryFreeMB: Number(memoryFreeRaw) || 0,
                        powerDrawW: Number(powerDrawRaw) || 0,
                        powerLimitW: Number(powerLimitRaw) || 0,
                    };
                }
            }
            resolve();
        });
    });

    await getGpuInfo;
};

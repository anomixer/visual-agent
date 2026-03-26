// AI PC Agent Plugin File v1

/**
 * @name TemperatureMonitor
 * @description NVIDIA GPU temperature and utilization monitor via nvidia-smi.
 * @author AI PC Agent Team
 * @version 2026.03.25
 */

const { exec } = require('child_process');

/**
 * NVIDIA GPU temperature monitor plugin.
 * @param {Object} health Shared system health object.
 */
module.exports = async function(health) {
    // Try to collect detailed NVIDIA GPU information.
    const gpuInfoCmd = `nvidia-smi --query-gpu=name,driver_version,temperature.gpu,utilization.gpu,memory.total,memory.used,memory.free,power.draw,power.limit --format=csv,noheader,nounits`;

    // Try to read CPU temperature. This usually fails without elevated privileges, so it remains optional.
    const cpuTempCmd = `powershell -Command "Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue | Select-Object -ExpandProperty CurrentTemperature"`;
    void cpuTempCmd;

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

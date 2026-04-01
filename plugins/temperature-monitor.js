// AI PC Agent Plugin File v1

/**
 * @name TemperatureMonitor
 * @description NVIDIA GPU temperature and utilization monitor via nvidia-smi.
 * @author AI PC Agent Team
 * @version 2026.03.25
 */

const { execFile } = require('child_process');
const path = require('path');

function resolveNvidiaSmiCandidates() {
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    return [
        'nvidia-smi.exe',
        path.join(programFiles, 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe'),
        path.join(programFilesX86, 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe'),
    ];
}

function runNvidiaSmiOnce(executablePath) {
    return new Promise((resolve) => {
        execFile(
            executablePath,
            [
                '--query-gpu=name,driver_version,temperature.gpu,utilization.gpu,memory.total,memory.used,memory.free,power.draw,power.limit',
                '--format=csv,noheader,nounits'
            ],
            { timeout: 8000, windowsHide: true },
            (error, stdout) => resolve({ error, stdout: String(stdout || ''), executablePath })
        );
    });
}

/**
 * NVIDIA GPU temperature monitor plugin.
 * @param {Object} health Shared system health object.
 */
module.exports = async function(health) {
    const candidates = resolveNvidiaSmiCandidates();
    let lastError = null;

    for (const executablePath of candidates) {
        const result = await runNvidiaSmiOnce(executablePath);
        if (!result.error && result.stdout) {
            const firstLine = result.stdout.trim().split(/\r?\n/)[0];
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
                    probeSource: executablePath
                };
                return;
            }
        }
        lastError = result.error;
    }

    if (lastError) {
        const errorCode = lastError.code || 'ERR';
        console.log(`[TemperatureMonitor] nvidia-smi not available (${errorCode}).`);
    }
};

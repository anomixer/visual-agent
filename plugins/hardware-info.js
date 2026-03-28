// AI PC Agent Plugin File v1

/**
 * @name HardwareInfo
 * @description Core hardware monitoring plugin. Collects CPU load, GPU name/load fallback data,
 *              and disk health information. GPU load should preferably come from
 *              temperature-monitor (nvidia-smi); this plugin provides WMI fallback data.
 * @author AI PC Agent Team
 * @version 2026.03.25
 */

const { exec } = require('child_process');

/**
 * Core hardware monitoring plugin.
 * @param {Object} health Shared system health object.
 */
module.exports = async function(health) {
    // 1) CPU, disk, and GPU name via WMI. Fast and stable baseline probe.
    const psBasic = `
        $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1 LoadPercentage;
        $disk = Get-PhysicalDisk | Select-Object DeviceID, FriendlyName, MediaType, HealthStatus, OperationalStatus;
        $logicalDisk = Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object DeviceID, VolumeName, Size, FreeSpace;
        $gpu = Get-CimInstance Win32_VideoController | Select-Object -First 1 Name;
        $smart = Get-WmiObject -namespace root\\wmi -class MSStorageDriver_FailurePredictStatus -ErrorAction SilentlyContinue;
        @{
            cpuLoad = $cpu.LoadPercentage;
            gpuName = $gpu.Name;
            disks = $disk;
            logicalDisks = $logicalDisk;
            smart = $smart;
        } | ConvertTo-Json -Depth 3
    `;

    // 2) GPU utilization via Get-Counter. This may fail in packaged/Tauri mode, so it is fallback-only.
    const psGpuLoad = `
        try {
            $g = Get-Counter '\\GPU Engine(*)\\Utilization Percentage' -ErrorAction Stop |
                 Select-Object -ExpandProperty CounterSamples |
                 Measure-Object -Property CookedValue -Sum;
            [math]::Round($g.Sum)
        } catch { -1 }
    `;

    const basicData = await new Promise((resolve) => {
        exec(`powershell -NoProfile -Command "${psBasic.replace(/\n/g, ' ')}"`, { timeout: 10000 }, (err, stdout) => {
            if (!err && stdout) {
                try { 
                    const parsed = JSON.parse(stdout);
                    // console.log('[HardwareInfo] Basic data collected successfully');
                    resolve(parsed); 
                    return; 
                } catch (e) {
                    console.error('[HardwareInfo] Failed to parse PowerShell output:', e.message);
                }
            } else {
                console.error('[HardwareInfo] PowerShell execution failed:', err?.message || 'Unknown error');
            }
            resolve(null);
        });
    });

    if (basicData) {
        health.cpu.load = basicData.cpuLoad ?? health.cpu.load;

        // Only use the WMI GPU name when temperature-monitor has not already filled it from nvidia-smi.
        if (!health.gpu.name && basicData.gpuName) {
            health.gpu.name = Array.isArray(basicData.gpuName)
                ? basicData.gpuName[0]
                : basicData.gpuName;
        }

        if (basicData.disks) {
            const diskArr = Array.isArray(basicData.disks) ? basicData.disks : [basicData.disks];
            health.disk.drives = diskArr.map(d => {
                let type = d.MediaType === 4 ? 'SSD' : (d.MediaType === 3 ? 'HDD' : 'Storage');
                if ((type === 'Storage' || type === 'HDD') && /SSD|NVMe|Flash/i.test(d.FriendlyName)) {
                    type = 'SSD';
                }
                return { name: d.FriendlyName, type, health: d.HealthStatus, status: d.OperationalStatus };
            });
            if (health.disk.drives.some(d => d.health !== 'Healthy')) {
                health.disk.status = 'Warning';
            }
        }

        if (basicData.logicalDisks) {
            const arr = Array.isArray(basicData.logicalDisks) ? basicData.logicalDisks : [basicData.logicalDisks];
            health.disk.volumes = arr.map(d => ({
                name: d.DeviceID,
                label: d.VolumeName || d.DeviceID,
                size: Number(d.Size) || 0,
                free: Number(d.FreeSpace) || 0,
            }));
        }

        if (basicData.smart) {
            const smartArr = Array.isArray(basicData.smart) ? basicData.smart : [basicData.smart];
            if (smartArr.some(s => s.PredictFailure === true)) {
                health.disk.status = 'Critical S.M.A.R.T Failure';
            }
        }
    }

    // GPU load fallback: only attempt this when temperature-monitor did not provide a value.
    if (health.gpu.load === 0 || health.gpu.load === undefined) {
        await new Promise((resolve) => {
            exec(`powershell -NoProfile -Command "${psGpuLoad.replace(/\n/g, ' ')}"`, { timeout: 5000 }, (err, stdout) => {
                if (!err && stdout) {
                    const v = parseInt(stdout.trim(), 10);
                    if (v >= 0) {
                        health.gpu.load = v;
                        // console.log('[HardwareInfo] GPU load fallback successful:', v);
                    }
                } else {
                    // console.log('[HardwareInfo] GPU load fallback failed, using default value');
                }
                resolve();
            });
        });
    }
};

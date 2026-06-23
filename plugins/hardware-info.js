// Visual Agent Plugin File v1

/**
 * @name HardwareInfo
 * @description Core hardware monitoring plugin. Collects CPU load, GPU name/load fallback data,
 *              and disk health information. GPU load should preferably come from
 *              temperature-monitor (nvidia-smi); this plugin provides WMI fallback data.
 * @author Visual Agent Team
 * @version 2026.03.25
 */

const { execFile } = require('child_process');

function runPowerShell(script, timeout = 10000) {
    return new Promise((resolve) => {
        const encoded = Buffer.from(String(script || ''), 'utf16le').toString('base64');
        execFile(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
            { timeout, windowsHide: true },
            (error, stdout) => resolve({ error, stdout: String(stdout || '') })
        );
    });
}

/**
 * Core hardware monitoring plugin.
 * @param {Object} health Shared system health object.
 */
module.exports = async function(health) {
    // 1) CPU, disk, and GPU name via WMI. Fast and stable baseline probe.
    const psBasic = `
        $ErrorActionPreference = 'Stop'
        [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
        $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1 LoadPercentage
        $disk = @()
        try {
            $disk = Get-PhysicalDisk | Select-Object DeviceID, FriendlyName, MediaType, HealthStatus, OperationalStatus
        } catch {
            $disk = @()
        }
        if (-not $disk -or $disk.Count -eq 0) {
            $disk = Get-CimInstance Win32_DiskDrive | Select-Object DeviceID, Model, MediaType, Status, Size
        }
        $logicalDisk = Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object DeviceID, VolumeName, Size, FreeSpace
        $gpu = Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name
        $smart = Get-CimInstance -Namespace root\\wmi -ClassName MSStorageDriver_FailurePredictStatus -ErrorAction SilentlyContinue
        @{
            cpuLoad = $cpu.LoadPercentage
            gpuName = $gpu
            disks = $disk
            logicalDisks = $logicalDisk
            smart = $smart
        } | ConvertTo-Json -Depth 6 -Compress
    `

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
        runPowerShell(psBasic, 10000).then(({ error, stdout }) => {
            if (!error && stdout) {
                try {
                    resolve(JSON.parse(stdout));
                    return;
                } catch {
                    console.warn('[HardwareInfo] Unable to parse baseline probe output.');
                }
            } else if (error) {
                console.warn(`[HardwareInfo] Baseline probe failed (${error.code || 'ERR'}).`);
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
                const name = d.FriendlyName || d.Model || d.DeviceID || 'Disk';
                let type = d.MediaType === 4 ? 'SSD' : (d.MediaType === 3 ? 'HDD' : 'Storage');
                if ((type === 'Storage' || type === 'HDD') && /SSD|NVMe|Flash/i.test(name)) {
                    type = 'SSD';
                }
                if ((type === 'Storage') && /HDD|SATA/i.test(String(d.MediaType || ''))) {
                    type = 'HDD';
                }
                return {
                    name,
                    type,
                    health: d.HealthStatus || d.Status || 'Unknown',
                    status: d.OperationalStatus || d.Status || 'Unknown'
                };
            });
            if (health.disk.drives.some(d => String(d.health || '').toLowerCase() !== 'healthy')) {
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
            runPowerShell(psGpuLoad, 5000).then(({ error, stdout }) => {
                if (!error && stdout) {
                    const v = parseInt(String(stdout).trim(), 10);
                    if (Number.isFinite(v) && v >= 0) {
                        health.gpu.load = v;
                    }
                }
                resolve();
            });
        });
    }
};

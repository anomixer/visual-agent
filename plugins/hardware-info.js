/**
 * @name HardwareInfo
 * @description 基礎硬體監控插件，負責獲取 CPU 負載、GPU 名稱與負載、磁碟 S.M.A.R.T 健康度資訊。
 *              GPU load 優先由 temperature-monitor (nvidia-smi) 提供；此插件提供 WMI fallback。
 * @author AI PC Agent Team
 * @version 2026.03.25
 */

const { exec } = require('child_process');

/**
 * 基礎硬體監控插件
 * @param {Object} health - 共享的系統健康物件
 */
module.exports = async function(health) {
    // 1) CPU + disk + GPU name (WMI, 快速且穩定)
    const psBasic = `
        $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1 LoadPercentage;
        $disk = Get-PhysicalDisk | Select-Object DeviceID, FriendlyName, MediaType, HealthStatus, OperationalStatus;
        $logicalDisk = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Select-Object DeviceID, VolumeName, Size, FreeSpace;
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

    // 2) GPU utilization via Get-Counter (Tauri/packaged 環境下可能失敗，僅作 fallback)
    const psGpuLoad = `
        try {
            $g = Get-Counter '\\GPU Engine(*)\\Utilization Percentage' -ErrorAction Stop |
                 Select-Object -ExpandProperty CounterSamples |
                 Measure-Object -Property CookedValue -Sum;
            [math]::Round($g.Sum)
        } catch { -1 }
    `;

    const basicData = await new Promise((resolve) => {
        exec(`powershell -NoProfile -Command "${psBasic.replace(/\n/g, ' ')}"`, (err, stdout) => {
            if (!err && stdout) {
                try { resolve(JSON.parse(stdout)); return; } catch (_) {}
            }
            resolve(null);
        });
    });

    if (basicData) {
        health.cpu.load = basicData.cpuLoad ?? health.cpu.load;

        // GPU 名稱：若 nvidia-smi (temperature-monitor) 尚未填入，才用 WMI 值
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

    // GPU load fallback（只在 temperature-monitor 未填入時才嘗試）
    if (health.gpu.load === 0 || health.gpu.load === undefined) {
        await new Promise((resolve) => {
            exec(`powershell -NoProfile -Command "${psGpuLoad.replace(/\n/g, ' ')}"`, (err, stdout) => {
                if (!err && stdout) {
                    const v = parseInt(stdout.trim(), 10);
                    if (v >= 0) health.gpu.load = v;
                }
                resolve();
            });
        });
    }
};

/**
 * @name HardwareInfo
 * @description 基礎硬體監控插件，負責獲取 CPU 負載、GPU 名稱與負載、磁碟 S.M.A.R.T 健康度資訊。
 * @author AI PC Agent Team
 * @version 2026.03.17
 */

const { exec } = require('child_process');

/**
 * 基礎硬體監控插件
 * @param {Object} health - 共享的系統健康物件
 */
module.exports = async function(health) {
    const psCommand = `
        $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1 LoadPercentage;
        $disk = Get-PhysicalDisk | Select-Object DeviceID, FriendlyName, MediaType, HealthStatus, OperationalStatus;
        $logicalDisk = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Select-Object DeviceID, VolumeName, Size, FreeSpace;
        $gpu = Get-CimInstance Win32_VideoController | Select-Object Name;
        $gpuLoadRaw = Get-Counter '\\GPU Engine(*)\\Utilization Percentage' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty CounterSamples | Measure-Object -Property CookedValue -Sum;
        $smart = Get-WmiObject -namespace root\\wmi -class MSStorageDriver_FailurePredictStatus -ErrorAction SilentlyContinue;
        
        @{
            cpuLoad = $cpu.LoadPercentage;
            gpuName = $gpu.Name;
            gpuLoad = [math]::Round($gpuLoadRaw.Sum);
            disks = $disk;
            logicalDisks = $logicalDisk;
            smart = $smart;
        } | ConvertTo-Json -Depth 3
    `;

    return new Promise((resolve) => {
        exec(`powershell -Command "${psCommand.replace(/\n/g, ' ')}"`, (err, stdout) => {
            if (!err && stdout) {
                try {
                    const raw = JSON.parse(stdout);
                    health.cpu.load = raw.cpuLoad || health.cpu.load;
                    health.gpu.name = Array.isArray(raw.gpuName) ? raw.gpuName[0] : raw.gpuName;
                    health.gpu.load = raw.gpuLoad || 0;
                    
                    if (raw.disks) {
                        const diskArr = Array.isArray(raw.disks) ? raw.disks : [raw.disks];
                        health.disk.drives = diskArr.map(d => {
                            let type = d.MediaType === 4 ? 'SSD' : (d.MediaType === 3 ? 'HDD' : 'Storage');
                            if (type === 'Storage' || type === 'HDD') {
                                if (/SSD|NVMe|Flash/i.test(d.FriendlyName)) type = 'SSD';
                            }
                            return {
                                name: d.FriendlyName,
                                type: type,
                                health: d.HealthStatus,
                                status: d.OperationalStatus
                            };
                        });
                        
                        if (health.disk.drives.some(d => d.health !== 'Healthy')) {
                            health.disk.status = 'Warning';
                        }
                    }

                    if (raw.logicalDisks) {
                        const logicalDiskArr = Array.isArray(raw.logicalDisks) ? raw.logicalDisks : [raw.logicalDisks];
                        health.disk.volumes = logicalDiskArr.map(d => ({
                            name: d.DeviceID,
                            label: d.VolumeName || d.DeviceID,
                            size: Number(d.Size) || 0,
                            free: Number(d.FreeSpace) || 0,
                        }));
                    }

                    if (raw.smart) {
                        const smartArr = Array.isArray(raw.smart) ? raw.smart : [raw.smart];
                        if (smartArr.some(s => s.PredictFailure === true)) {
                            health.disk.status = 'Critical S.M.A.R.T Failure';
                        }
                    }
                } catch (e) {
                    // console.error('[Plugin: HardwareInfo] Parse failed:', e);
                }
            }
            resolve();
        });
    });
};

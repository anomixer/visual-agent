const { exec } = require('child_process');
const os = require('os');

/**
 * 獲取系統核心資訊 (CPU, RAM, Disk)
 */
async function getSystemHealth() {
    const health = {
        cpu: { load: 0, temp: null, cores: os.cpus().length, model: os.cpus()[0].model },
        ram: { total: os.totalmem(), free: os.freemem(), usage: 0 },
        gpu: { name: 'N/A', load: 0 },
        disk: { status: 'OK', drives: [] },
        uptime: os.uptime(),
        timestamp: new Date().toISOString()
    };

    // 1. 計算 RAM 使用率
    health.ram.usage = Math.round(((health.ram.total - health.ram.free) / health.ram.total) * 100);

    // 2. 透過 PowerShell 獲取更詳細資訊
    const psCommand = `
        $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1 LoadPercentage;
        $mem = Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize, FreePhysicalMemory;
        $disk = Get-PhysicalDisk | Select-Object DeviceID, FriendlyName, MediaType, HealthStatus, OperationalStatus;
        $gpu = Get-CimInstance Win32_VideoController | Select-Object Name;
        $gpuLoadRaw = Get-Counter '\\GPU Engine(*)\\Utilization Percentage' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty CounterSamples | Measure-Object -Property CookedValue -Sum;
        $smart = Get-WmiObject -namespace root\\wmi -class MSStorageDriver_FailurePredictStatus -ErrorAction SilentlyContinue;
        
        @{
            cpuLoad = $cpu.LoadPercentage;
            gpuName = $gpu.Name;
            gpuLoad = [math]::Round($gpuLoadRaw.Sum);
            disks = $disk;
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
                        
                        // 如果有任何硬碟不健康
                        if (health.disk.drives.some(d => d.health !== 'Healthy')) {
                            health.disk.status = 'Warning';
                        }
                    }

                    if (raw.smart) {
                        const smartArr = Array.isArray(raw.smart) ? raw.smart : [raw.smart];
                        if (smartArr.some(s => s.PredictFailure === true)) {
                            health.disk.status = 'Critical S.M.A.R.T Failure';
                        }
                    }
                } catch (e) {
                    console.error('[System] Parse health data failed:', e);
                }
            }
            resolve(health);
        });
    });
}

module.exports = { getSystemHealth };

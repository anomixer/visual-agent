/**
 * SOP Executor - Visual Agent
 *
 * 接收由 sop-parser 解析出的 sop 物件，按照以下流程執行：
 *   1. Check  → 檢查是否已完成（若已完成則跳過）
 *   2. Install → 執行安裝指令
 *   3. Verify  → 驗證安裝結果
 *   4. Error Handling → 自動排錯後重試
 *
 * 所有指令透過 PowerShell 執行，回傳結構化結果。
 * emits EventEmitter 事件以便 UI 層非同步呈現進度。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const EventEmitter = require('events');

class SOPExecutor extends EventEmitter {
    buildWrappedCommand(command) {
        return [
            '$utf8NoBom = New-Object System.Text.UTF8Encoding($false)',
            '[Console]::InputEncoding = $utf8NoBom',
            '[Console]::OutputEncoding = $utf8NoBom',
            '$OutputEncoding = $utf8NoBom',
            command,
        ].join('; ');
    }

    escapePowerShellSingleQuoted(value) {
        return String(value).replace(/'/g, "''");
    }

    /**
     * @param {object} options
     * @param {boolean} [options.dryRun=false] - true 時僅列出將執行的指令，不實際執行
     * @param {number} [options.maxRetries=2] - 排錯後重試次數上限
     * @param {number} [options.timeoutMs=1800000] - 單一指令逾時 (ms), 預設 30 分鐘
     */
    constructor(options = {}) {
        super();
        this.dryRun = options.dryRun ?? false;
        this.maxRetries = options.maxRetries ?? 2;
        this.timeoutMs = options.timeoutMs ?? 1800_000; // 預設 30 分鐘，給大型下載足夠時間
    }

    /**
     * 執行單一 PowerShell 指令
     * @param {string} command - PowerShell 指令字串
     * @returns {Promise<{exitCode: number, stdout: string, stderr: string}>}
     */
    runPowerShell(command) {
        return new Promise((resolve, reject) => {
            if (this.dryRun) {
                this.emit('log', { level: 'dry-run', message: `[DRY-RUN] ${command}` });
                resolve({ exitCode: 0, stdout: '[dry-run]', stderr: '' });
                return;
            }

            // 直接在 PowerShell 內設定 UTF-8，避免 chcp > nul 在部分環境觸發 Out-File / device 錯誤
            const wrappedCommand = this.buildWrappedCommand(command);

            const child = spawn('powershell.exe', [
                '-NoProfile',
                '-NonInteractive',
                '-ExecutionPolicy', 'Bypass',
                '-Command', wrappedCommand,
            ], {
                windowsHide: true,
            });

            let stdout = '';
            let stderr = '';
            let timedOut = false;
            let lastLogTime = 0;

            const stripAnsi = (str) => {
                if (!str) return '';
                // Matches ANSI escape codes
                return str.replace(/[\u001b\u009b][[()#;?]*(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~]*)*|[a-zA-Z\d])/g, '');
            };

            const processChunk = (data) => {
                const str = data.toString('utf8');
                const now = Date.now();
                if (now - lastLogTime > 500) {
                    const cleanStr = stripAnsi(str);
                    const lines = cleanStr.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);
                    if (lines.length > 0) {
                        this.emit('log', { level: 'info', phase: 'running', message: `... ${lines[lines.length - 1]}` });
                        lastLogTime = now;
                    }
                }
            };

            const timer = setTimeout(() => {
                timedOut = true;
                child.kill('SIGTERM');
            }, this.timeoutMs);

            child.stdout.setEncoding('utf8');
            child.stderr.setEncoding('utf8');

            child.stdout.on('data', (data) => {
                stdout += data;
                processChunk(data);
            });

            child.stderr.on('data', (data) => {
                stderr += data;
                processChunk(data);
            });

            child.on('close', (code) => {
                clearTimeout(timer);
                if (timedOut) {
                    reject(new Error(`Command timed out after ${this.timeoutMs}ms: ${command}`));
                } else {
                    // 即使 exitCode 非 0，也要回傳結果讓上層判斷
                    resolve({ exitCode: code, stdout: stdout.trim(), stderr: stderr.trim() });
                }
            });

            child.on('error', (err) => {
                clearTimeout(timer);
                reject(err);
            });
        });
    }

    /**
     * 嘗試將錯誤訊息比對 sop 的錯誤處理表，找出對應的修復動作
     * @param {string} errorText - stderr 或 stdout 中的錯誤訊息
     * @param {object[]} errorHandlers - sop.errorHandling 陣列
     * @returns {object|null} 匹配到的 errorHandler 或 null
     */
    runPowerShellElevated(command) {
        return new Promise((resolve, reject) => {
            if (this.dryRun) {
                this.emit('log', { level: 'dry-run', message: `[DRY-RUN][ELEVATED] ${command}` });
                resolve({ exitCode: 0, stdout: '[dry-run elevated]', stderr: '' });
                return;
            }

            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-agent-elevated-'));
            const runnerPath = path.join(tempDir, 'runner.ps1');
            const logPath = path.join(tempDir, 'combined.log');
            const exitPath = path.join(tempDir, 'exitcode.txt');

            const quotedRunnerPath = this.escapePowerShellSingleQuoted(runnerPath);
            const quotedLogPath = this.escapePowerShellSingleQuoted(logPath);
            const quotedExitPath = this.escapePowerShellSingleQuoted(exitPath);

            const runnerScript = [
                "$utf8NoBom = New-Object System.Text.UTF8Encoding($false)",
                "[Console]::InputEncoding = $utf8NoBom",
                "[Console]::OutputEncoding = $utf8NoBom",
                "$OutputEncoding = $utf8NoBom",
                "$ErrorActionPreference = 'Continue'",
                "$global:LASTEXITCODE = 0",
                'try {',
                '    & {',
                command,
                `    } *> '${quotedLogPath}'`,
                '    $exitCode = if ($LASTEXITCODE -is [int]) { $LASTEXITCODE } else { 0 }',
                '} catch {',
                `    ($_ | Out-String) | Out-File -FilePath '${quotedLogPath}' -Append -Encoding utf8`,
                '    $exitCode = 1',
                '}',
                `Set-Content -Path '${quotedExitPath}' -Value $exitCode -Encoding utf8`,
                'exit $exitCode',
            ].join('\r\n');

            fs.writeFileSync(runnerPath, runnerScript, 'utf8');

            const launchCommand = [
                '$ErrorActionPreference = "Stop"',
                'try {',
                `    $proc = Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Minimized -Wait -PassThru -ArgumentList @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', '${quotedRunnerPath}')`,
                '    exit $proc.ExitCode',
                '} catch {',
                '    $msg = $_ | Out-String',
                "    if ($msg -match 'cancelled by the user' -or $msg -match 'canceled by the user' -or $msg -match 'operation was canceled') {",
                "        Write-Error 'UAC elevation was cancelled by user.'",
                '        exit 1223',
                '    }',
                '    Write-Error $msg',
                '    exit 1',
                '}',
            ].join('; ');

            this.emit('log', {
                level: 'info',
                phase: 'install',
                message: 'This task requires administrator privileges, triggering UAC window...',
            });

            const child = spawn('powershell.exe', [
                '-NoProfile',
                '-NonInteractive',
                '-ExecutionPolicy', 'Bypass',
                '-Command', launchCommand,
            ], {
                windowsHide: true,
            });

            let stderr = '';
            let timedOut = false;

            const cleanup = () => {
                try {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                } catch {}
            };

            const timer = setTimeout(() => {
                timedOut = true;
                child.kill('SIGTERM');
            }, this.timeoutMs);

            child.stderr.setEncoding('utf8');
            child.stderr.on('data', (data) => {
                stderr += data;
            });

            child.on('close', (code) => {
                clearTimeout(timer);
                if (timedOut) {
                    cleanup();
                    reject(new Error(`Elevated command timed out after ${this.timeoutMs}ms: ${command}`));
                    return;
                }

                const stdout = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').trim() : '';
                const fileExitCode = fs.existsSync(exitPath)
                    ? Number.parseInt(fs.readFileSync(exitPath, 'utf8').trim(), 10)
                    : Number.NaN;
                const exitCode = Number.isNaN(fileExitCode) ? (code ?? 1) : fileExitCode;

                cleanup();
                resolve({ exitCode, stdout, stderr: stderr.trim() });
            });

            child.on('error', (err) => {
                clearTimeout(timer);
                cleanup();
                reject(err);
            });
        });
    }

    matchError(errorText, errorHandlers) {
        if (!errorText || !errorHandlers || errorHandlers.length === 0) return null;
        const combined = errorText.toLowerCase();

        for (const handler of errorHandlers) {
            if (combined.includes(handler.code.toLowerCase())) {
                return handler;
            }
        }
        return null;
    }

    /**
     * 執行一組 PowerShell 指令（同一階段的所有 commands）
     * @param {string[]} commands
     * @param {string} phaseName
     * @returns {Promise<{success: boolean, outputs: object[], error: string|null}>}
     */
    async runPhaseCommands(commands, phaseName, options = {}) {
        const outputs = [];
        const runner = options.elevate ? this.runPowerShellElevated.bind(this) : this.runPowerShell.bind(this);

        for (const cmd of commands) {
            this.emit('log', {
                level: 'info',
                phase: phaseName,
                message: `Executing command: ${cmd.trim().substring(0, 120)}...`,
            });

            try {
                const result = await runner(cmd);
                outputs.push({ command: cmd, ...result });

                if (result.exitCode !== 0) {
                    const errorMsg = result.stderr || result.stdout || `Exit code: ${result.exitCode}`;
                    this.emit('log', {
                        level: 'error',
                        phase: phaseName,
                        message: `指令返回非零結束碼 (${result.exitCode})`,
                        detail: errorMsg,
                    });
                    return { success: false, outputs, error: errorMsg };
                }

                if (phaseName === 'verify' && this.isVerifyFailed(result.stdout)) {
                    const errorMsg = result.stdout || 'Verify returned false';
                    this.emit('log', {
                        level: 'error',
                        phase: phaseName,
                        message: 'Verification script returned false',
                        detail: errorMsg,
                    });
                    return { success: false, outputs, error: errorMsg };
                }

                this.emit('log', {
                    level: 'success',
                    phase: phaseName,
                    message: `Command executed successfully`,
                    detail: result.stdout.substring(0, 200),
                });
            } catch (err) {
                outputs.push({ command: cmd, error: err.message });
                this.emit('log', {
                    level: 'error',
                    phase: phaseName,
                    message: `Command execution error: ${err.message}`,
                });
                return { success: false, outputs, error: err.message };
            }
        }

        return { success: true, outputs, error: null };
    }

    /**
     * Check phase allows stdout to contain hint text, any standalone line 'true' is considered complete
     * @param {string} stdout
     * @returns {boolean}
     */
    isCheckSatisfied(stdout) {
        if (!stdout) return false;
        const lines = stdout
            .split(/\r?\n/)
            .map((line) => line.trim().toLowerCase())
            .filter(Boolean);

        if (lines.length === 0) return false;
        return lines.includes('true') || lines[lines.length - 1] === 'true';
    }

    /**
     * Verify 階段若明確輸出 false，應視為驗證失敗
     * @param {string} stdout
     * @returns {boolean}
     */
    isVerifyFailed(stdout) {
        if (!stdout) return false;
        const lines = stdout
            .split(/\r?\n/)
            .map((line) => line.trim().toLowerCase())
            .filter(Boolean);

        if (lines.length === 0) return false;
        return lines.includes('false') && !lines.includes('true');
    }

    /**
     * 自動排錯 — 根據錯誤碼執行修復動作
     * @param {object} handler - matchError 回傳的 handler
     * @returns {Promise<boolean>} 修復是否成功
     */
    async executeErrorHandler(handler) {
        this.emit('log', {
            level: 'warn',
            phase: 'error-handling',
            message: `偵測到錯誤 ${handler.code}: ${handler.cause}`,
        });

        let requiresManual = false;

        for (const action of handler.actions) {
            this.emit('log', {
                level: 'info',
                phase: 'error-handling',
                message: `自動修復動作: ${action}`,
            });

            // 嘗試將修復動作中的描述轉為 PowerShell 指令
            const psCmd = this.actionToCommand(action, handler.code);
            if (psCmd) {
                try {
                    const result = await this.runPowerShell(psCmd);
                    if (result.exitCode !== 0) {
                        this.emit('log', {
                            level: 'error',
                            phase: 'error-handling',
                            message: `修復動作失敗: ${result.stderr}`,
                        });
                        return { fixed: false, requiresManual };
                    }
                } catch {
                    return { fixed: false, requiresManual };
                }
            } else {
                requiresManual = true;
            }
        }

        return { fixed: !requiresManual, requiresManual };
    }

    /**
     * 將自然語言修復動作轉為 PowerShell 指令
     * 這裡內建一些常見的模式對應，未來可接入 LLM 做動態轉譯。
     * @param {string} action — 修復動作描述
     * @param {string} errorCode — 原始錯誤碼
     * @returns {string|null} PowerShell 指令或 null
     */
    actionToCommand(action, errorCode) {
        const lowerAction = action.toLowerCase();

        // 啟動 Windows Update 服務
        if (lowerAction.includes('wuauserv') || lowerAction.includes('windows update')) {
            return 'Start-Service wuauserv';
        }

        // 檢查網路狀態
        if (lowerAction.includes('檢查網路') || lowerAction.includes('check network')) {
            return 'Test-NetConnection -ComputerName www.microsoft.com -Port 443 -InformationLevel Quiet';
        }

        // 磁碟清理
        if (lowerAction.includes('磁碟清理') || lowerAction.includes('disk cleanup')) {
            return 'cleanmgr /sagerun:1';
        }

        // 無法自動轉譯 — 記錄 log，未來可接入 LLM
        this.emit('log', {
            level: 'info',
            phase: 'error-handling',
            message: `需要手動處理: ${action}`,
        });
        return null;
    }

    /**
     * 完整執行一個 SOP（Check → Install → Verify + Error Handling）
     * @param {object} sop — 由 sop-parser 產生的結構化 sop 物件
     * @returns {Promise<object>} 執行結果
     */
    sopRequiresElevation(sop) {
        const permissions = sop?.prerequisites?.permissions || '';
        return /administrator|admin|uac/i.test(permissions);
    }

    async execute(sop, options = {}) {
        const action = options.action === 'uninstall' ? 'uninstall' : 'install';
        const actionPhase = action === 'uninstall' ? 'uninstall' : 'install';
        const actionLabel = action === 'uninstall' ? '解除安裝' : '安裝';
        const result = {
            sopId: sop.id,
            sopName: sop.name,
            action,
            status: 'pending', // pending | skipped | success | failed
            phases: {},
            startTime: new Date().toISOString(),
            endTime: null,
        };

        this.emit('sop:start', { id: sop.id, name: sop.name });
        const requiresElevation = this.sopRequiresElevation(sop);

        // ── Phase 1: Check ──────────────────────────────────────────────
        if (sop.steps.check.commands.length > 0) {
            this.emit('phase:start', { phase: 'check', sop: sop.id });

            const checkResult = await this.runPhaseCommands(sop.steps.check.commands, 'check');
            result.phases.check = checkResult;

            if (checkResult.success) {
                // 檢查回傳值是否為 True（表示已安裝，可跳過）
                const lastOutput = checkResult.outputs[checkResult.outputs.length - 1];
                const isInstalled = lastOutput && this.isCheckSatisfied(lastOutput.stdout);
                if (action === 'install' && isInstalled) {
                    this.emit('log', {
                        level: 'success',
                        phase: 'check',
                        message: '已偵測到目標已安裝，跳過執行。',
                    });
                    result.status = 'skipped';
                    result.endTime = new Date().toISOString();
                    this.emit('sop:end', result);
                    return result;
                }

                if (action === 'uninstall' && !isInstalled) {
                    this.emit('log', {
                        level: 'success',
                        phase: 'check',
                        message: '已偵測到目標不在系統中，跳過解除安裝。',
                    });
                    result.status = 'skipped';
                    result.endTime = new Date().toISOString();
                    this.emit('sop:end', result);
                    return result;
                }
            }

            this.emit('phase:end', { phase: 'check', success: checkResult.success });
        }

        // ── Phase 2: Action ─────────────────────────────────────────────
        let actionSuccess = false;
        let retries = 0;
        const actionStep = sop.steps[actionPhase];

        while (retries <= this.maxRetries) {
            if (!actionStep || actionStep.commands.length === 0) {
                throw new Error(`SOP 缺少${actionLabel}階段指令`);
            }

            if (actionStep.commands.length === 0) {
                actionSuccess = true;
                break;
            }

            if (actionStep.uiMessage) {
                this.emit('ui:message', { message: actionStep.uiMessage });
            }

            this.emit('phase:start', { phase: actionPhase, sop: sop.id, attempt: retries + 1 });

            const installResult = await this.runPhaseCommands(
                actionStep.commands,
                actionPhase,
                { elevate: requiresElevation }
            );
            result.phases[actionPhase] = installResult;

            if (installResult.success) {
                actionSuccess = true;
                this.emit('phase:end', { phase: actionPhase, success: true });
                break;
            }

            // ── Error Handling ────────────────────────────────────────────
            const handler = this.matchError(installResult.error, sop.errorHandling);

            if (handler && retries < this.maxRetries) {
                const fixResult = await this.executeErrorHandler(handler);
                if (fixResult.fixed) {
                    retries++;
                    this.emit('log', {
                        level: 'info',
                        phase: actionPhase,
                        message: `修復完成，重新嘗試${actionLabel} (第 ${retries} 次重試)...`,
                    });
                    continue;
                }

                if (fixResult.requiresManual) {
                    this.emit('log', {
                        level: 'error',
                        phase: actionPhase,
                        message: '此錯誤需要手動處理，停止自動重試。',
                    });
                }
            }

            // 無法處理的錯誤
            this.emit('log', {
                level: 'error',
                phase: actionPhase,
                message: `${actionLabel}失敗且無法自動修復: ${installResult.error}`,
            });
            result.status = 'failed';
            result.endTime = new Date().toISOString();
            this.emit('sop:end', result);
            return result;
        }

        // ── Phase 3: Verify ─────────────────────────────────────────────
        if (action === 'install' && actionSuccess && sop.steps.verify.commands.length > 0) {
            this.emit('phase:start', { phase: 'verify', sop: sop.id });

            const verifyResult = await this.runPhaseCommands(sop.steps.verify.commands, 'verify');
            result.phases.verify = verifyResult;

            if (verifyResult.success) {
                result.status = 'success';
                this.emit('log', {
                    level: 'success',
                    phase: 'verify',
                    message: 'Verification passed! Task completed successfully.',
                });
            } else {
                result.status = 'failed';
                this.emit('log', {
                    level: 'error',
                    phase: 'verify',
                    message: 'Verification failed, installation may be incomplete.',
                });
            }

            this.emit('phase:end', { phase: 'verify', success: verifyResult.success });
        } else if (action === 'uninstall' && actionSuccess && sop.steps.check.commands.length > 0) {
            this.emit('phase:start', { phase: 'verify', sop: sop.id });
            // Reuse the check script to confirm the target is now absent.
            // For uninstall verification, `false` means success, so we must not
            // run this through the normal verify=false failure rule.
            const verifyResult = await this.runPhaseCommands(sop.steps.check.commands, 'check');
            result.phases.verify = verifyResult;
            const lastOutput = verifyResult.outputs[verifyResult.outputs.length - 1];
            const stillInstalled = lastOutput && this.isCheckSatisfied(lastOutput.stdout);

            if (verifyResult.success && !stillInstalled) {
                result.status = 'success';
                this.emit('log', {
                    level: 'success',
                    phase: 'verify',
                    message: 'Uninstall verification passed, target successfully removed.',
                });
            } else {
                result.status = 'failed';
                this.emit('log', {
                    level: 'error',
                    phase: 'verify',
                    message: 'Post-uninstall check still shows target exists.',
                });
            }

            this.emit('phase:end', { phase: 'verify', success: result.status === 'success' });
        } else if (actionSuccess) {
            result.status = 'success';
        }

        result.endTime = new Date().toISOString();
        this.emit('sop:end', result);
        return result;
    }
}

module.exports = { SOPExecutor };

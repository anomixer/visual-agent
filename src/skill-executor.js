/**
 * Skill Executor - AI PC Agent
 *
 * 接收由 skill-parser 解析出的 skill 物件，按照以下流程執行：
 *   1. Check  → 檢查是否已完成（若已完成則跳過）
 *   2. Install → 執行安裝指令
 *   3. Verify  → 驗證安裝結果
 *   4. Error Handling → 自動排錯後重試
 *
 * 所有指令透過 PowerShell 執行，回傳結構化結果。
 * emits EventEmitter 事件以便 UI 層非同步呈現進度。
 */

const { spawn } = require('child_process');
const EventEmitter = require('events');

class SkillExecutor extends EventEmitter {
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

            const child = spawn('powershell.exe', [
                '-NoProfile',
                '-NonInteractive',
                '-ExecutionPolicy', 'Bypass',
                '-Command', command,
            ]);

            let stdout = '';
            let stderr = '';
            let timedOut = false;
            let lastLogTime = 0;

            const processChunk = (data) => {
                const str = data.toString();
                const now = Date.now();
                if (now - lastLogTime > 500) {
                    const lines = str.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);
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

            child.stdout.on('data', (data) => {
                stdout += data.toString();
                processChunk(data);
            });

            child.stderr.on('data', (data) => {
                stderr += data.toString();
                processChunk(data);
            });

            child.on('close', (code) => {
                clearTimeout(timer);
                if (timedOut) {
                    reject(new Error(`Command timed out after ${this.timeoutMs}ms: ${command}`));
                } else {
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
     * 嘗試將錯誤訊息比對 skill 的錯誤處理表，找出對應的修復動作
     * @param {string} errorText - stderr 或 stdout 中的錯誤訊息
     * @param {object[]} errorHandlers - skill.errorHandling 陣列
     * @returns {object|null} 匹配到的 errorHandler 或 null
     */
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
    async runPhaseCommands(commands, phaseName) {
        const outputs = [];

        for (const cmd of commands) {
            this.emit('log', {
                level: 'info',
                phase: phaseName,
                message: `執行指令: ${cmd.trim().substring(0, 120)}...`,
            });

            try {
                const result = await this.runPowerShell(cmd);
                outputs.push({ command: cmd, ...result });

                if (result.exitCode !== 0) {
                    this.emit('log', {
                        level: 'warn',
                        phase: phaseName,
                        message: `指令返回非零結束碼 (${result.exitCode})`,
                        detail: result.stderr || result.stdout,
                    });
                    return { success: false, outputs, error: result.stderr || result.stdout };
                }

                this.emit('log', {
                    level: 'success',
                    phase: phaseName,
                    message: `指令執行成功`,
                    detail: result.stdout.substring(0, 200),
                });
            } catch (err) {
                outputs.push({ command: cmd, error: err.message });
                return { success: false, outputs, error: err.message };
            }
        }

        return { success: true, outputs, error: null };
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
                        return false;
                    }
                } catch {
                    return false;
                }
            }
        }

        return true;
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
     * 完整執行一個 Skill（Check → Install → Verify + Error Handling）
     * @param {object} skill — 由 skill-parser 產生的結構化 skill 物件
     * @returns {Promise<object>} 執行結果
     */
    async execute(skill) {
        const result = {
            skillId: skill.id,
            skillName: skill.name,
            status: 'pending', // pending | skipped | success | failed
            phases: {},
            startTime: new Date().toISOString(),
            endTime: null,
        };

        this.emit('skill:start', { id: skill.id, name: skill.name });

        // ── Phase 1: Check ──────────────────────────────────────────────
        if (skill.steps.check.commands.length > 0) {
            this.emit('phase:start', { phase: 'check', skill: skill.id });

            const checkResult = await this.runPhaseCommands(skill.steps.check.commands, 'check');
            result.phases.check = checkResult;

            if (checkResult.success) {
                // 檢查回傳值是否為 True（表示已安裝，可跳過）
                const lastOutput = checkResult.outputs[checkResult.outputs.length - 1];
                if (lastOutput && lastOutput.stdout && lastOutput.stdout.trim().toLowerCase() === 'true') {
                    this.emit('log', {
                        level: 'success',
                        phase: 'check',
                        message: '已偵測到目標已安裝，跳過執行。',
                    });
                    result.status = 'skipped';
                    result.endTime = new Date().toISOString();
                    this.emit('skill:end', result);
                    return result;
                }
            }

            this.emit('phase:end', { phase: 'check', success: checkResult.success });
        }

        // ── Phase 2: Install ────────────────────────────────────────────
        let installSuccess = false;
        let retries = 0;

        while (retries <= this.maxRetries) {
            if (skill.steps.install.commands.length === 0) {
                installSuccess = true;
                break;
            }

            if (skill.steps.install.uiMessage) {
                this.emit('ui:message', { message: skill.steps.install.uiMessage });
            }

            this.emit('phase:start', { phase: 'install', skill: skill.id, attempt: retries + 1 });

            const installResult = await this.runPhaseCommands(skill.steps.install.commands, 'install');
            result.phases.install = installResult;

            if (installResult.success) {
                installSuccess = true;
                this.emit('phase:end', { phase: 'install', success: true });
                break;
            }

            // ── Error Handling ────────────────────────────────────────────
            const handler = this.matchError(installResult.error, skill.errorHandling);

            if (handler && retries < this.maxRetries) {
                const fixed = await this.executeErrorHandler(handler);
                if (fixed) {
                    retries++;
                    this.emit('log', {
                        level: 'info',
                        phase: 'install',
                        message: `修復完成，重新嘗試安裝 (第 ${retries} 次重試)...`,
                    });
                    continue;
                }
            }

            // 無法處理的錯誤
            this.emit('log', {
                level: 'error',
                phase: 'install',
                message: `安裝失敗且無法自動修復: ${installResult.error}`,
            });
            result.status = 'failed';
            result.endTime = new Date().toISOString();
            this.emit('skill:end', result);
            return result;
        }

        // ── Phase 3: Verify ─────────────────────────────────────────────
        if (installSuccess && skill.steps.verify.commands.length > 0) {
            this.emit('phase:start', { phase: 'verify', skill: skill.id });

            const verifyResult = await this.runPhaseCommands(skill.steps.verify.commands, 'verify');
            result.phases.verify = verifyResult;

            if (verifyResult.success) {
                result.status = 'success';
                this.emit('log', {
                    level: 'success',
                    phase: 'verify',
                    message: '驗證通過！任務已成功完成。',
                });
            } else {
                result.status = 'failed';
                this.emit('log', {
                    level: 'error',
                    phase: 'verify',
                    message: '驗證失敗，安裝可能不完整。',
                });
            }

            this.emit('phase:end', { phase: 'verify', success: verifyResult.success });
        } else if (installSuccess) {
            result.status = 'success';
        }

        result.endTime = new Date().toISOString();
        this.emit('skill:end', result);
        return result;
    }
}

module.exports = { SkillExecutor };

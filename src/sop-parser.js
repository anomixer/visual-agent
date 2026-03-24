/**
 * SOP Parser - AI PC Agent
 * 
 * 解析 sops/ 目錄下的 .md 標準作業程序書，提取：
 *   - Metadata（ID, 名稱, 分類, 風險等級）
 *   - Prerequisites（OS, 權限, 網路需求）
 *   - Execution Steps（Check / Install / Verify 各階段的 PowerShell 指令）
 *   - Error Handling（錯誤代碼對應的自動修復邏輯）
 */

const fs = require('fs');
const path = require('path');

/**
 * 解析單一 sop.md 檔案
 * @param {string} filePath - sop 檔案的絕對路徑
 * @returns {object} 結構化的 sop 物件
 */
function parseSOPFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);

    const sop = {
        id: null,
        name: null,
        category: null,
        riskLevel: null,
        prerequisites: {
            os: null,
            permissions: null,
            network: null,
        },
        steps: {
            check: { commands: [], expectedResult: null, uiMessage: null },
            install: { commands: [], expectedResult: null, uiMessage: null },
            verify: { commands: [], expectedResult: null, uiMessage: null },
        },
        errorHandling: [],
        sourceFile: path.basename(filePath),
    };

    let currentSection = null;   // 'metadata' | 'prerequisites' | 'steps' | 'error'
    let currentPhase = null;     // 'check' | 'install' | 'verify'
    let inCodeBlock = false;
    let codeBlockContent = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // ── Code block extraction (MUST be first to avoid false matches) ─
        if (/^```\s*(powershell)?$/i.test(trimmed)) {
            if (!inCodeBlock) {
                inCodeBlock = true;
                codeBlockContent = [];
                continue;
            } else {
                // Closing code block
                inCodeBlock = false;
                if (currentSection === 'steps' && currentPhase && codeBlockContent.length > 0) {
                    // Filter out non-command lines (like UI display notes inside code blocks)
                    const commands = codeBlockContent.filter(
                        (cmd) => cmd.trim() && !/^UI\s*顯示/i.test(cmd.trim())
                    );
                    if (commands.length > 0) {
                        // 將整塊程式碼合成一個指令執行，解決變數跨行失效問題
                        sop.steps[currentPhase].commands.push(commands.join('\n'));
                    }

                    // Extract UI message if present
                    const uiLine = codeBlockContent.find((cmd) =>
                        /^UI\s*顯示/i.test(cmd.trim())
                    );
                    if (uiLine) {
                        const match = uiLine.match(/[「「](.+?)[」」]/);
                        if (match) {
                            sop.steps[currentPhase].uiMessage = match[1];
                        } else {
                            // Try extracting after colon
                            const colonMatch = uiLine.match(/[:：]\s*(.+)/);
                            if (colonMatch) {
                                sop.steps[currentPhase].uiMessage = colonMatch[1].trim().replace(/^[「「]|[」」]$/g, '');
                            }
                        }
                    }
                }
                continue;
            }
        }

        if (inCodeBlock) {
            codeBlockContent.push(line);
            continue;
        }

        // ── Section detection ───────────────────────────────────────────
        if (/基本資訊|metadata/i.test(trimmed)) {
            currentSection = 'metadata';
            currentPhase = null;
            continue;
        }
        if (/需求環境|prerequisites/i.test(trimmed)) {
            currentSection = 'prerequisites';
            currentPhase = null;
            continue;
        }
        if (/執行流程|execution\s*steps/i.test(trimmed)) {
            currentSection = 'steps';
            currentPhase = null;
            continue;
        }
        if (/自動排錯|error\s*handling/i.test(trimmed)) {
            currentSection = 'error';
            currentPhase = null;
            continue;
        }

        // ── Phase detection (within steps section) ──────────────────────
        // Only match phase headers — lines like "第一階段：環境檢測 (Check)"
        if (currentSection === 'steps') {
            if (/第.*階段.*環境檢測|^##*\s*.*check/i.test(trimmed)) {
                currentPhase = 'check';
                continue;
            }
            if (/第.*階段.*安裝|^##*\s*.*install/i.test(trimmed)) {
                currentPhase = 'install';
                continue;
            }
            if (/第.*階段.*驗證|^##*\s*.*verify/i.test(trimmed)) {
                currentPhase = 'verify';
                continue;
            }
        }

        // ── Metadata parsing ────────────────────────────────────────────
        if (currentSection === 'metadata') {
            const idMatch = trimmed.match(/^ID:\s*(.+)/i);
            if (idMatch) sop.id = idMatch[1].trim();

            const nameMatch = trimmed.match(/^名稱:\s*(.+)/i);
            if (nameMatch) sop.name = nameMatch[1].trim();

            const nameMatch2 = trimmed.match(/^Name:\s*(.+)/i);
            if (nameMatch2) sop.name = sop.name || nameMatch2[1].trim();

            const catMatch = trimmed.match(/^分類:\s*(.+)/i);
            if (catMatch) sop.category = catMatch[1].trim();

            const riskMatch = trimmed.match(/^風險等級:\s*(.+)/i);
            if (riskMatch) sop.riskLevel = riskMatch[1].trim();
        }

        // ── Prerequisites parsing ───────────────────────────────────────
        if (currentSection === 'prerequisites') {
            const osMatch = trimmed.match(/^OS:\s*(.+)/i);
            if (osMatch) sop.prerequisites.os = osMatch[1].trim();

            const permMatch = trimmed.match(/^權限:\s*(.+)/i);
            if (permMatch) sop.prerequisites.permissions = permMatch[1].trim();

            const netMatch = trimmed.match(/^網路:\s*(.+)/i);
            if (netMatch) sop.prerequisites.network = netMatch[1].trim();
        }

        // ── Expected result parsing ─────────────────────────────────────
        if (currentSection === 'steps' && currentPhase) {
            const resultMatch = trimmed.match(/^預期結果:\s*(.+)/i);
            if (resultMatch) {
                sop.steps[currentPhase].expectedResult = resultMatch[1].trim();
            }

            // UI display message outside code block
            const uiMatch = trimmed.match(/UI\s*顯示內容:\s*[「「](.+?)[」」]/i);
            if (uiMatch) {
                sop.steps[currentPhase].uiMessage = uiMatch[1];
            }
        }

        // ── Error handling parsing ──────────────────────────────────────
        if (currentSection === 'error' && trimmed && !/^錯誤代碼/.test(trimmed)) {
            // Format: errorCode,cause,actions
            const parts = trimmed.split(',');
            if (parts.length >= 3) {
                sop.errorHandling.push({
                    code: parts[0].trim(),
                    cause: parts[1].trim(),
                    actions: parts
                        .slice(2)
                        .join(',')
                        .trim()
                        .split(/\d+\.\s*/)
                        .filter(Boolean)
                        .map((a) => a.trim()),
                });
            }
        }
    }

    return sop;
}

/**
 * 掃描 sops 目錄，解析所有 .md 標準作業程序書
 * @param {string} sopsDir - sops 目錄路徑
 * @returns {object[]} 所有解析後的 sop 物件陣列
 */
function loadAllSOPs(sopsDir) {
    const resolvedDir = path.resolve(sopsDir);

    if (!fs.existsSync(resolvedDir)) {
        throw new Error(`SOPs directory not found: ${resolvedDir}`);
    }

    const files = fs.readdirSync(resolvedDir).filter((f) => f.endsWith('.md'));
    const parsed = files.map((f) => parseSOPFile(path.join(resolvedDir, f)));
    const deduped = new Map();

    const scoreFile = (sop) => {
        const name = (sop.sourceFile || '').toLowerCase();
        let score = 0;
        if (!name.includes('copy')) score += 10;
        if (!name.includes('副本')) score += 10;
        if (name === `${sop.id}.md`) score += 5;
        return score;
    };

    for (const sop of parsed) {
        if (!sop.id) {
            deduped.set(`${sop.sourceFile}:${Math.random()}`, sop);
            continue;
        }

        const existing = deduped.get(sop.id);
        if (!existing || scoreFile(sop) > scoreFile(existing)) {
            deduped.set(sop.id, sop);
        }
    }

    return Array.from(deduped.values());
}

module.exports = { parseSOPFile, loadAllSOPs };

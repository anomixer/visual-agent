/**
 * SOP Parser - AI PC Agent
 *
 * Parses markdown SOP files in the sops/ directory and extracts:
 * - Metadata (ID, Name, Category, Risk Level)
 * - Prerequisites (OS, Permissions, Network)
 * - Execution Steps (PowerShell commands for Check / Install / Uninstall / Verify)
 * - Error Handling (automatic recovery hints for known errors)
 */

const fs = require('fs');
const path = require('path');

/**
 * Parses a single SOP markdown file.
 * @param {string} filePath Absolute path to the SOP file.
 * @returns {object} Structured SOP object.
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
            uninstall: { commands: [], expectedResult: null, uiMessage: null },
            verify: { commands: [], expectedResult: null, uiMessage: null },
        },
        errorHandling: [],
        sourceFile: path.basename(filePath),
    };

    let currentSection = null;
    let currentPhase = null;
    let inCodeBlock = false;
    let codeBlockContent = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // Code block extraction must run first to avoid false section matches.
        if (/^```\s*(powershell)?$/i.test(trimmed)) {
            if (!inCodeBlock) {
                inCodeBlock = true;
                codeBlockContent = [];
                continue;
            }

            inCodeBlock = false;
            if (currentSection === 'steps' && currentPhase && codeBlockContent.length > 0) {
                // Filter out non-command lines such as embedded UI message notes.
                const commands = codeBlockContent.filter(
                    (cmd) => cmd.trim() && !/^UI\s*(顯示|Message)/i.test(cmd.trim())
                );
                if (commands.length > 0) {
                    // Execute the full PowerShell block as one command so variables survive across lines.
                    sop.steps[currentPhase].commands.push(commands.join('\n'));
                }

                // Extract UI message if present.
                const uiLine = codeBlockContent.find((cmd) =>
                    /^UI\s*(顯示|Message)/i.test(cmd.trim())
                );
                if (uiLine) {
                    const quotedMatch = uiLine.match(/["“「](.+?)["”」]/);
                    if (quotedMatch) {
                        sop.steps[currentPhase].uiMessage = quotedMatch[1];
                    } else {
                        const colonMatch = uiLine.match(/[:：]\s*(.+)/);
                        if (colonMatch) {
                            sop.steps[currentPhase].uiMessage = colonMatch[1]
                                .trim()
                                .replace(/^["“「]|["”」]$/g, '');
                        }
                    }
                }
            }
            continue;
        }

        if (inCodeBlock) {
            codeBlockContent.push(line);
            continue;
        }

        // Section detection.
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

        // Phase detection within the Execution Steps section.
        if (currentSection === 'steps') {
            if (/第.*階段.*環境檢測|^##*\s*.*check/i.test(trimmed)) {
                currentPhase = 'check';
                continue;
            }
            if (/第.*階段.*解除安裝|第.*階段.*移除|^##*\s*.*uninstall|^##*\s*.*remove/i.test(trimmed)) {
                currentPhase = 'uninstall';
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

        // Metadata parsing.
        if (currentSection === 'metadata') {
            const idMatch = trimmed.match(/^ID:\s*(.+)/i);
            if (idMatch) sop.id = idMatch[1].trim();

            const nameMatch = trimmed.match(/^名稱:\s*(.+)/i);
            if (nameMatch) sop.name = nameMatch[1].trim();
            const nameMatch2 = trimmed.match(/^Name:\s*(.+)/i);
            if (nameMatch2) sop.name = sop.name || nameMatch2[1].trim();

            const catMatch = trimmed.match(/^分類:\s*(.+)/i);
            if (catMatch) sop.category = catMatch[1].trim();
            const catMatch2 = trimmed.match(/^Category:\s*(.+)/i);
            if (catMatch2) sop.category = sop.category || catMatch2[1].trim();

            const riskMatch = trimmed.match(/^風險等級:\s*(.+)/i);
            if (riskMatch) sop.riskLevel = riskMatch[1].trim();
            const riskMatch2 = trimmed.match(/^Risk\s*Level:\s*(.+)/i);
            if (riskMatch2) sop.riskLevel = sop.riskLevel || riskMatch2[1].trim();
        }

        // Prerequisites parsing.
        if (currentSection === 'prerequisites') {
            const osMatch = trimmed.match(/^OS:\s*(.+)/i);
            if (osMatch) sop.prerequisites.os = osMatch[1].trim();

            const permMatch = trimmed.match(/^權限:\s*(.+)/i);
            if (permMatch) sop.prerequisites.permissions = permMatch[1].trim();
            const permMatch2 = trimmed.match(/^Permissions:\s*(.+)/i);
            if (permMatch2) sop.prerequisites.permissions = sop.prerequisites.permissions || permMatch2[1].trim();

            const netMatch = trimmed.match(/^網路:\s*(.+)/i);
            if (netMatch) sop.prerequisites.network = netMatch[1].trim();
            const netMatch2 = trimmed.match(/^Network:\s*(.+)/i);
            if (netMatch2) sop.prerequisites.network = sop.prerequisites.network || netMatch2[1].trim();
        }

        // Expected result and UI message parsing.
        if (currentSection === 'steps' && currentPhase) {
            const resultMatch = trimmed.match(/^預期結果:\s*(.+)/i);
            if (resultMatch) {
                sop.steps[currentPhase].expectedResult = resultMatch[1].trim();
            }
            const resultMatch2 = trimmed.match(/^Expected\s*Result:\s*(.+)/i);
            if (resultMatch2) {
                sop.steps[currentPhase].expectedResult = sop.steps[currentPhase].expectedResult || resultMatch2[1].trim();
            }

            const uiMatch = trimmed.match(/UI\s*(顯示內容|Message):\s*["“「](.+?)["”」]/i);
            if (uiMatch) {
                sop.steps[currentPhase].uiMessage = uiMatch[2];
            }
        }

        // Error handling parsing.
        if (currentSection === 'error' && trimmed && !/^錯誤代碼|^Error\s*Code/i.test(trimmed)) {
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
 * Scans the sops directory and parses all markdown SOP files.
 * @param {string} sopsDir Path to the sops directory.
 * @returns {object[]} Parsed SOP objects.
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

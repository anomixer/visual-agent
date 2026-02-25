/**
 * AI PC Agent - CLI Entry Point
 *
 * 用法:
 *   node src/index.js                    # 掃描 skills/ 目錄並列出所有 skill
 *   node src/index.js --run <skill-id>   # 執行指定 skill
 *   node src/index.js --run-all          # 依序執行所有 skill
 *   node src/index.js --dry-run <skill-id> # 模擬執行（不實際跑 PowerShell）
 *   node src/index.js --export           # 匯出所有 skill 為 JSON
 */

const path = require('path');
const fs = require('fs');
const { loadAllSkills, parseSkillFile } = require('./skill-parser');
const { SkillExecutor } = require('./skill-executor');

// ── Config ─────────────────────────────────────────────────────────
const SKILLS_DIR = path.resolve(__dirname, '..', 'skills');
const EXPORT_FILE = path.resolve(__dirname, '..', 'skills-export.json');

// ── Pretty Logging ─────────────────────────────────────────────────
const ICONS = {
    info: '💡',
    success: '✅',
    warn: '⚠️',
    error: '❌',
    'dry-run': '🔍',
};

function prettyLog(event) {
    const icon = ICONS[event.level] || '📌';
    const phase = event.phase ? `[${event.phase}]` : '';
    console.log(`  ${icon} ${phase} ${event.message}`);
    if (event.detail) {
        console.log(`     ↳ ${event.detail.substring(0, 200)}`);
    }
}

// ── Commands ───────────────────────────────────────────────────────

function listSkills() {
    const skills = loadAllSkills(SKILLS_DIR);
    console.log('\n┌─────────────────────────────────────────────────┐');
    console.log('│          AI PC Agent — Skill 清單               │');
    console.log('└─────────────────────────────────────────────────┘\n');

    if (skills.length === 0) {
        console.log('  (沒有找到任何 skill 檔案)\n');
        return;
    }

    for (const s of skills) {
        const phases = [];
        if (s.steps.check.commands.length > 0) phases.push('Check');
        if (s.steps.install.commands.length > 0) phases.push('Install');
        if (s.steps.verify.commands.length > 0) phases.push('Verify');

        console.log(`  📦 ${s.id || '(no id)'}`);
        console.log(`     名稱: ${s.name || '(未命名)'}`);
        console.log(`     分類: ${s.category || '-'}`);
        console.log(`     風險: ${s.riskLevel || '-'}`);
        console.log(`     階段: ${phases.join(' → ') || '(無指令)'}`);
        console.log(`     排錯: ${s.errorHandling.length} 條規則`);
        console.log(`     檔案: ${s.sourceFile}`);
        console.log('');
    }
}

async function runSkill(skillId, dryRun = false) {
    const skills = loadAllSkills(SKILLS_DIR);
    const skill = skills.find((s) => s.id === skillId);

    if (!skill) {
        console.error(`\n  ❌ 找不到 skill: "${skillId}"`);
        console.error(`  可用的 skill ID: ${skills.map((s) => s.id).join(', ') || '(無)'}\n`);
        process.exit(1);
    }

    console.log(`\n┌─────────────────────────────────────────────────┐`);
    console.log(`│  🚀 執行 Skill: ${skill.name || skill.id}`);
    console.log(`│  模式: ${dryRun ? 'DRY-RUN (模擬)' : 'LIVE (真實執行)'}`);
    console.log(`└─────────────────────────────────────────────────┘\n`);

    const executor = new SkillExecutor({ dryRun });

    executor.on('log', prettyLog);
    executor.on('skill:start', (e) => console.log(`\n  ▶️  開始: ${e.name} (${e.id})`));
    executor.on('phase:start', (e) => console.log(`\n  ── ${e.phase.toUpperCase()} Phase ──${e.attempt ? ` (嘗試 #${e.attempt})` : ''}`));
    executor.on('phase:end', (e) => console.log(`  ── /${e.phase.toUpperCase()} (${e.success ? '成功' : '失敗'}) ──`));
    executor.on('ui:message', (e) => console.log(`\n  💬 ${e.message}\n`));
    executor.on('skill:end', (e) => {
        const icon = { success: '🎉', skipped: '⏭️', failed: '💔' }[e.status] || '❓';
        console.log(`\n  ${icon} 最終狀態: ${e.status.toUpperCase()}`);
        console.log(`     耗時: ${e.startTime} → ${e.endTime}\n`);
    });

    const result = await executor.execute(skill);
    return result;
}

async function runAllSkills(dryRun = false) {
    const skills = loadAllSkills(SKILLS_DIR);
    console.log(`\n  📋 共發現 ${skills.length} 個 skill，依序執行...\n`);

    const results = [];
    for (const skill of skills) {
        const result = await runSkill(skill.id, dryRun);
        results.push(result);
    }

    // Summary
    console.log('\n┌─────────────────────────────────────────────────┐');
    console.log('│          執行摘要                                │');
    console.log('└─────────────────────────────────────────────────┘\n');
    for (const r of results) {
        const icon = { success: '✅', skipped: '⏭️', failed: '❌' }[r.status] || '❓';
        console.log(`  ${icon} ${r.skillId}: ${r.status}`);
    }
    console.log('');
}

function exportSkills() {
    const skills = loadAllSkills(SKILLS_DIR);
    fs.writeFileSync(EXPORT_FILE, JSON.stringify(skills, null, 2), 'utf-8');
    console.log(`\n  ✅ 已匯出 ${skills.length} 個 skill 至: ${EXPORT_FILE}\n`);
}

// ── CLI Argument Parsing ───────────────────────────────────────────

async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        listSkills();
        return;
    }

    const flag = args[0];

    switch (flag) {
        case '--run':
            if (!args[1]) {
                console.error('  ❌ 請指定 skill ID，例如: node src/index.js --run sys_lang_ja_jp');
                process.exit(1);
            }
            await runSkill(args[1]);
            break;

        case '--dry-run':
            if (!args[1]) {
                console.error('  ❌ 請指定 skill ID，例如: node src/index.js --dry-run sys_lang_ja_jp');
                process.exit(1);
            }
            await runSkill(args[1], true);
            break;

        case '--run-all':
            await runAllSkills();
            break;

        case '--dry-run-all':
            await runAllSkills(true);
            break;

        case '--export':
            exportSkills();
            break;

        case '--help':
        default:
            console.log(`
  AI PC Agent — Skill 執行工具

  用法:
    node src/index.js                       列出所有可用的 skill
    node src/index.js --run <skill-id>      執行指定 skill
    node src/index.js --dry-run <skill-id>  模擬執行（不實際跑 PowerShell）
    node src/index.js --run-all             依序執行所有 skill
    node src/index.js --dry-run-all         模擬執行所有 skill
    node src/index.js --export              匯出所有 skill 為 JSON
    node src/index.js --help                顯示此說明
      `);
            break;
    }
}

main().catch((err) => {
    console.error('\n  ❌ 未預期的錯誤:', err.message);
    process.exit(1);
});

// 修復 i18n 漏網之魚的補丁檔案
// 使用方式：將此檔案內容複製到 app.js 的對應位置

const i18nPatches = {
    'zh-TW': {
        // 在 chalkboard 物件中加入
        chalkboard: {
            exportSuccess: '黑板圖片已匯出：{fileName}',
            exportCancelled: '已取消匯出黑板圖片',
            exportFallback: '原生匯出圖片失敗，已改用瀏覽器下載：{error}',
        },
        // 在 status 物件前加入
        ollama: {
            notDetected: '未偵測到 Ollama，自動加入安裝任務',
            installing: '未偵測到本地 AI 引擎（Ollama）。系統正自動為您安裝，請在出現提示時允許權限。',
            ready: 'Ollama 已就緒，自動加入模型下載任務',
            downloading: 'Ollama 已就緒，正在自動為您下載 qwen3.5 語言模型，請稍候...',
        },
        // 在 task 物件中加入
        task: {
            autoExecute: '自動執行：{title}',
        },
        // 在 buttons 物件前加入
        tasks: {
            exportSuccess: '任務清單已匯出：{fileName}',
            exportSuccessChat: '任務清單已匯出成功。',
            exportCancelled: '已取消匯出任務清單',
            exportFallback: '原生匯出失敗，已改用瀏覽器下載：{error}',
            importSuccess: '任務清單已匯入',
            importFailed: '匯入失敗：JSON 格式錯誤',
        }
    },
    'en-US': {
        // 在 chalkboard 物件中加入
        chalkboard: {
            exportSuccess: 'Chalkboard image exported: {fileName}',
            exportCancelled: 'Chalkboard export cancelled',
            exportFallback: 'Native export failed, fallback to browser download: {error}',
        },
        // 在 status 物件前加入
        ollama: {
            notDetected: 'Ollama not detected, automatically adding installation task',
            installing: 'Local AI engine (Ollama) not detected. System is automatically installing it, please allow permissions when prompted.',
            ready: 'Ollama is ready, automatically adding model download task',
            downloading: 'Ollama is ready, automatically downloading qwen3.5 language model, please wait...',
        },
        // 在 task 物件中加入
        task: {
            autoExecute: 'Auto-executing: {title}',
        },
        // 在 buttons 物件前加入
        tasks: {
            exportSuccess: 'Task list exported: {fileName}',
            exportSuccessChat: 'Task list exported successfully.',
            exportCancelled: 'Task list export cancelled',
            exportFallback: 'Native export failed, fallback to browser download: {error}',
            importSuccess: 'Task list imported',
            importFailed: 'Import failed: JSON format error',
        }
    }
};

console.log('i18n 補丁檔案已準備，請手動將上述翻譯鍵值加入到 app.js 的對應位置');

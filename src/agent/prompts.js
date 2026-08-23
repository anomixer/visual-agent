/**
 * Prompt 组装 — 軟體推薦(winget / Microsoft Store / GitHub Releases)的 LLM 提示註解。
 * 純函式、無 I/O、可獨立測試。自 server.js /api/chat handler 抽出(行為一致)。
 */
'use strict';

// 依三種推薦來源各生成一段「注入 LLM 的候選軟體提示」；該來源無候選時回空字串。
// 回傳 { wingetPromptNote, microsoftStorePromptNote, githubPromptNote }。
function buildRecommendationPromptNotes({
    wingetRecommendation,
    microsoftStoreRecommendation,
    githubRecommendation,
} = {}) {
    // 套件行（winget / msstore 通用）。注意 map 回调约定是 (element, index)，此处 element=套件。
    const pkgLine = (pkg, index) => `${index + 1}. ${pkg.name} | id=${pkg.id} | version=${pkg.version || 'unknown'}`;

    const wingetPromptNote = wingetRecommendation?.packages?.length
        ? `\n\n[[winget 商店候選軟體]]\n使用者此刻在詢問軟體推薦，而且目前 SOP 未必有直接對應項目。若你要推薦軟體，請優先參考下列 winget 結果來列出「軟體名稱」。若使用者要求產生對應 SOP，請輸出 [ACTION:CREATE_WINGET_SOP package_id="..." package_name="..."]。\nQuery: ${wingetRecommendation.query}\n${wingetRecommendation.packages.map(pkgLine).join('\n')}`
        : '';

    const microsoftStorePromptNote = microsoftStoreRecommendation?.packages?.length
        ? `\n\n[[Microsoft Store 候選軟體]]\n使用者偏向 Microsoft Store / UWP / 商店版軟體。若你要推薦軟體，請優先參考下列 msstore 結果；若使用者要求建立 SOP，請輸出 [ACTION:CREATE_MSSTORE_SOP package_id="..." package_name="..."]。\nQuery: ${microsoftStoreRecommendation.query}\n${microsoftStoreRecommendation.packages.map(pkgLine).join('\n')}`
        : '';

    const githubPromptNote = githubRecommendation?.packages?.length
        ? `\n\n[[GitHub Releases 候選軟體]]\n使用者在找 GitHub 上有 Windows release 的開源 App。若你要推薦軟體，請優先參考下列候選；若使用者要求建立 SOP，請輸出 [ACTION:CREATE_GITHUB_RELEASE_SOP repo_full_name="..." asset_name="..." download_url="..."]。\nQuery: ${githubRecommendation.query}\n${githubRecommendation.packages.map((pkg, index) => `${index + 1}. ${pkg.name} | repo=${pkg.fullName} | tag=${pkg.tagName || 'latest'} | asset=${pkg.assetName}`).join('\n')}`
        : '';

    return { wingetPromptNote, microsoftStorePromptNote, githubPromptNote };
}

module.exports = { buildRecommendationPromptNotes };

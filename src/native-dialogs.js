'use strict';
const { execSync } = require('child_process');
const { escapePowerShellSingleQuoted } = require('./pure');

function buildSaveFileDialogScript(options = {}) {
    const filter = escapePowerShellSingleQuoted(options.filter || '');
    const fileName = escapePowerShellSingleQuoted(options.fileName || '');
    const title = escapePowerShellSingleQuoted(options.title || '');
    const initialDirectory = escapePowerShellSingleQuoted(options.initialDirectory || 'MyDocuments');
    return `
        Add-Type -AssemblyName System.Windows.Forms
        $dlg = New-Object System.Windows.Forms.SaveFileDialog
        $dlg.Filter = '${filter}'
        $dlg.FileName = '${fileName}'
        $dlg.Title = '${title}'
        $dlg.InitialDirectory = [Environment]::GetFolderPath('${initialDirectory}')
        $res = $dlg.ShowDialog()
        if ($res -eq [System.Windows.Forms.DialogResult]::OK) {
            Write-Output $dlg.FileName
        }
        `;
}

function runPowerShellScript(psScript) {
    return execSync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -Sta -Command "${psScript.replace(/\n/g, ';')}"`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
    });
}

function pickSaveFilePath(options = {}, run = runPowerShellScript) {
    return run(buildSaveFileDialogScript(options)).trim();
}

module.exports = { buildSaveFileDialogScript, pickSaveFilePath };

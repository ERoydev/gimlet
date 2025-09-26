const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

const debuggerSession = require('./state');
// A module that knows how to: resolve workspace paths, detect Cargo.toml, figure out package name and Anchor structure

/**
 * @typedef {Object} GimletConfig
 * @property {string} workspaceFolder
 * @property {string} depsPath
 * @property {string} inputPath
 * @property {string} packageName
 * @property {boolean} isAnchor
 * @property {string} [selectedProgram]
 */

/** @type {GimletConfig} */
// eslint-disable-next-line no-unused-vars
const config = {
    workspaceFolder: '',
    depsPath: '',
    inputPath: '',
    packageName: '',
    isAnchor: false,
    selectedProgram: undefined,
};

async function resolveGimletConfig() {
    const workspaceFolder = vscode.workspace.workspaceFolders[0].uri.fsPath;
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder found.');
        return null;
    }
    debuggerSession.globalWorkspaceFolder = workspaceFolder;

    const depsPath = path.join(workspaceFolder, 'target', 'deploy');
    const inputPath = path.join(workspaceFolder, 'input');
    debuggerSession.globalInputPath = inputPath;

    return {
        workspaceFolder,
        depsPath,
    };
}

module.exports = {
    resolveGimletConfig,
};

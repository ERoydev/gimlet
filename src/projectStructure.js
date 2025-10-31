const fs = require('fs');
const vscode = require('vscode');

async function safeReadDir(dirPath) {
    try {
        return await fs.promises.readdir(dirPath);
    } catch (err) {
        vscode.window.showErrorMessage(`Error reading directory after V1 build: ${err}`);
        return null;
    }
}

async function safeFileExists(filePath) {
    try {
        await fs.promises.access(filePath, fs.constants.F_OK);
        return true;
    } catch (err) {
        return false;
    }
}



module.exports = {  safeReadDir, safeFileExists };

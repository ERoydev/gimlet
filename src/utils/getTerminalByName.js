
const vscode = require('vscode');

function getTerminalByName(name) {
    return vscode.window.terminals.find((terminal) => terminal.name === name);
}

module.exports = getTerminalByName;
const { exec } = require('child_process');
const vscode = require('vscode');
const debuggerSession = require('../state');

class PortManager {
    constructor() {
        this.pollingActiveMap = {};
    }

    async isPortAvailable(port) {
        return new Promise((resolve) => {
            exec(
                `netstat -nat | grep -E '[:|.]${port}\\b' | wc -l`,
                (err, stdout, stderr) => {
                    if (stdout.trim() > 0) {
                        resolve(false);
                    } else {
                        resolve(true);
                    }
                }
            );
        });
    }

    async isPortOpen() {
        const port = debuggerSession.tcpPort;
        return new Promise((resolve) => {
            exec(
                `netstat -nat | grep -E '[:|.]${port}\\b' | grep 'LISTEN' | wc -l`,
                (err, stdout, stderr) => {
                    const isOpen = stdout.trim() === '1';
                    resolve(isOpen);
                }
            );
        });
    }

    async waitAndStartDebug(workspaceFolder, launchConfig) {
        const sessionName = launchConfig.name;
        if (this.pollingActiveMap[sessionName]) return;
        this.pollingActiveMap[sessionName] = true;

        while (this.pollingActiveMap[sessionName]) {
            const isOpen = await this.isPortOpen();

            const alreadyRunning = Array.isArray(vscode.debug.sessions)
                ? vscode.debug.sessions.some(session => session.name === sessionName)
                : false;

            if (isOpen && !alreadyRunning) {
                await vscode.debug.startDebugging(workspaceFolder, launchConfig);
            }

            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }

    stopPolling(sessionName) {
        this.pollingActiveMap[sessionName] = false;
    }
}

const portManager = new PortManager();

module.exports = portManager;
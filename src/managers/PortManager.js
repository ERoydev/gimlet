const { exec } = require('child_process');
const vscode = require('vscode');

class PortManager {
    constructor() {
        this.pollingActiveMap = {};
    }

    // Used primarily for the config setup to check if the desired port is available
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

    async isPortOpen(currentTcpPort) {
        const port = currentTcpPort; 
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

    // Waits for the specified TCP port to open, then starts a debug session with the given launch configuration.
    // When the debugger disconnects, but the port is opened again, it will start the debug session again.
    // Prevents multiple polling loops for the same session name.
    async waitAndStartDebug(workspaceFolder, launchConfig, currentTcpPort) {
        const sessionName = launchConfig.name;
        if (this.pollingActiveMap[sessionName]) return;
        this.pollingActiveMap[sessionName] = true;

        while (this.pollingActiveMap[sessionName]) {
            const isOpen = await this.isPortOpen(currentTcpPort);
            console.log(`Session name: ${sessionName}, Port ${currentTcpPort} open: ${isOpen}`);

            const alreadyRunning = Array.isArray(vscode.debug.sessions)
                ? vscode.debug.sessions.some(session => session.name === sessionName)
                : false;

            if (isOpen && !alreadyRunning) {
                await vscode.debug.startDebugging(workspaceFolder, launchConfig);
            }

            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }

    // TODO: Currently no mechanism to stop polling, could be added in the future if needed
    stopPolling(sessionName) {
        this.pollingActiveMap[sessionName] = false;
    }
}

const portManager = new PortManager();

module.exports = portManager;
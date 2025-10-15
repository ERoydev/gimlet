const { exec } = require('child_process');
const vscode = require('vscode');
const { debugConfigManager } = require('./DebugConfigManager');
const debuggerSession = require('../state');

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

            const alreadyRunning = Array.isArray(vscode.debug.sessions)
                ? vscode.debug.sessions.some(session => session.name === sessionName)
                : false;

            if (isOpen && !alreadyRunning) {
                await vscode.debug.startDebugging(workspaceFolder, launchConfig);
            }

            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }

    /**
     * Listen for up to 4 ports (for CPI depth 4).
     * When a port opens, use the program hash to create the launch config and start debugging.
     * @param {number[]} ports - array of ports to listen on
    */
    async listenAndStartDebugForPorts(ports) {
        const pollingKey = ports.join(',');
        if (this.pollingActiveMap[pollingKey]) return;
        this.pollingActiveMap[pollingKey] = true;

        // Track which ports have already started a debug session
        const startedPorts = new Set();
        console.log('Polling for ports:', this.pollingActiveMap);

        while (this.pollingActiveMap[pollingKey]) {
            for (const port of ports) {
                if (startedPorts.has(port)) continue;

                const isOpen = await this.isPortOpen(port);

                if (isOpen) {
                    // When port opens get the program name from the current hash
                    const programName = await debugConfigManager.waitForProgramName();
                    if (!programName) continue;

                    // Dynamically create launch config using program hash or other info
                    const launchConfig = debugConfigManager.getLaunchConfigForSolanaLldb(port, programName);
                    if (!launchConfig) continue;

                    const alreadyRunning = Array.isArray(vscode.debug.sessions)
                        ? vscode.debug.sessions.some(session => session.name === launchConfig.name)
                        : false;

                    if (!alreadyRunning) {
                        await vscode.debug.startDebugging(debuggerSession.globalWorkspaceFolder, launchConfig);
                        startedPorts.add(port);
                    }
                }
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    // TODO: Currently no mechanism to stop polling, could be added in the future if needed
    stopPolling(sessionName) {
        this.pollingActiveMap[sessionName] = false;
    }
}

const portManager = new PortManager();

module.exports = portManager;
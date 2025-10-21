const { exec } = require('child_process');
const vscode = require('vscode');
const { debugConfigManager } = require('./debugConfigManager');
const { globalState } = require('../state/globalState');

class PortManager {
    constructor() {
        this.pollingActiveMap = {}; // This is part of session state and should be cleaned when debugging session ends
        this.sessionToken = 0;
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

    /**
     * Listen for up to 4 ports (for CPI depth 4).
     * When a port opens, use the program hash to create the launch config and start debugging.
     * @param {number[]} ports - array of ports to listen on
    */
    async listenAndStartDebugForPorts(ports) {
        this.sessionToken += 1; 
        const myToken = this.sessionToken;

        const pollingKey = ports.join(',');
        if (this.pollingActiveMap[pollingKey]) return;
        this.pollingActiveMap[pollingKey] = true;

        // Track which ports have already started a debug session
        const startedPorts = new Set();
        while (this.pollingActiveMap[pollingKey] && this.sessionToken === myToken) {
            for (const port of ports) {
                if (startedPorts.has(port)) continue;

                const isOpen = await this.isPortOpen(port);

                if (isOpen) {
                    // When port opens get the program name from the current hash
                    const programName = await debugConfigManager.waitForProgramName();
                    if (!programName) {
                        vscode.window.showErrorMessage('Timed out waiting for program name. Stopping debug session.');
                        this.pollingActiveMap[pollingKey] = false; // Stop the while loop
                        // TODO: After fixing outputs make this stop the Debugger
                        // await vscode.debug.stopDebugging(); // This stops the active debug session
                        break; // Exit the for loop 
                    };

                    // Dynamically create launch config using program hash or other info
                    const launchConfig = debugConfigManager.getLaunchConfigForSolanaLldb(port, programName);
                    if (!launchConfig) continue;

                    const alreadyRunning = Array.isArray(vscode.debug.sessions)
                        ? vscode.debug.sessions.some(session => session.name === launchConfig.name)
                        : false;

                    if (!alreadyRunning) {
                        await vscode.debug.startDebugging(globalState.globalWorkspaceFolder, launchConfig);
                        startedPorts.add(port);
                    }
                }
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    cleanup() {
        this.sessionToken += 1; // Invalidate any ongoing polling loops
        this.pollingActiveMap = {};
    }
}

const portManager = new PortManager();

module.exports = portManager;
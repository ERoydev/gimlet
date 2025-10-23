const { exec } = require('child_process');
const vscode = require('vscode');
const { debugConfigManager } = require('./debugConfigManager');
const { globalState } = require('../state/globalState');

class PortManager {
    constructor() {
        this.pollingTokens = {}; // Map of pollingKey -> token
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
        const pollingKey = ports.join(',');
        if (this.pollingTokens[pollingKey]) return;

        const myToken = Symbol();
        this.pollingTokens[pollingKey] = myToken;

        // Track which ports have already started a debug session
        const startedPorts = new Set();
        while (this.pollingTokens[pollingKey] === myToken) {
            for (const port of ports) {
                if (startedPorts.has(port)) continue;

                const isOpen = await this.isPortOpen(port);

                if (isOpen) {
                    // When port opens get the program name from the current hash
                    const programName = await debugConfigManager.waitForProgramName();
                    if (!programName) {
                        vscode.window.showErrorMessage('Timed out waiting for program. Stopping debug session.');
                        delete this.pollingTokens[pollingKey]; // Stop the while loop
                        await vscode.debug.stopDebugging(); // This stops the active debug session
                        break;
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
        delete this.pollingTokens[pollingKey];
    }

    cleanup() {
        this.pollingTokens = {};
    }
}

const portManager = new PortManager();

module.exports = portManager;
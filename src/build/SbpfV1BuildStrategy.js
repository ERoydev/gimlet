const BaseBuildStrategy = require('./baseBuildStrategy');
const debuggerSession = require('../state');
const vscode = require('vscode');
const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');
const os = require('os');
const buildCommands = require('./buildCommands');
const { debuggerManager, LldbDebuggerManager } = require('../debuggerManager');
const getTerminalByName = require('../utils/getTerminalByName');

class SbpfV1BuildStrategy extends BaseBuildStrategy {
    constructor(
        workspaceFolder,
        packageName,
        depsPath,
        buildCommand = buildCommands.SBF_V1_DEBUG_TOOLS151
    ) {
        super(workspaceFolder, packageName, depsPath);
        this.buildCommand = buildCommand;
        this._breakpointStrategy = LldbDebuggerManager.lineNumberStrategy; // Default to line number strategy
    }

    static get BUILD_TYPE() {
        return 'V1';
    }

    get buildType() {
        return this.constructor.BUILD_TYPE;
    }

    async build(progress) {
        let files;
        try {
            files = await fs.promises.readdir(this.depsPath);
        } catch (readDirErr) {
            vscode.window.showErrorMessage(
                `Error reading directory: ${readDirErr}`
            );
            return;
        }

        const { executablePath, bpfCompiledPath} = this.findDebugExecutable(files);

        this._deleteIfExists(executablePath);
        this._deleteIfExists(bpfCompiledPath);

        return new Promise((resolve) => {
            exec(
                this.buildCommand,
                { cwd: this.workspaceFolder },
                (err, stdout, stderr) => {
                    if (err) {
                        vscode.window.showErrorMessage(
                            `Build error: ${stderr}`
                        );
                        resolve();
                        return;
                    }

                    if (progress)
                        progress.report({
                            increment: 50,
                            message: 'Setting up debugger...',
                        });
                    resolve(true);
                }
            );
        });
    }

    async setupDebugger(progress) {
        if (!fs.existsSync(this.depsPath)) {
            vscode.window.showErrorMessage(
                `Executable not found: ${this.depsPath}`
            );
            return;
        }

        let files;
        try {
            files = await fs.promises.readdir(this.depsPath);
        } catch (readDirErr) {
            vscode.window.showErrorMessage(
                `Error reading directory: ${readDirErr}`
            );
            return;
        }

        const { executablePath } = this.findDebugExecutable(files);
        if (!executablePath) {
            vscode.window.showErrorMessage(`No debug executable found`);
            return;
        }

        // Create or reuse terminal
        const terminal = vscode.window.createTerminal(
            'Solana LLDB Debugger',
        );
        
        // Set debugger states
        debuggerManager.setTerminal(terminal);
        debuggerManager.setBreakpointStrategy(this._breakpointStrategy); 

        // Start solana-lldb and set the target executable
        terminal.show();
        terminal.sendText('solana-lldb');
        terminal.sendText(`target create "${executablePath}"`);
                    
        // TCP port Polling
        this.tryConnectToTcpPortWithRetry(60000, 5000) // 1 minute timeout, 1 second interval
            .then(() => {
                this.startConnectionMonitor(5000); // Check connection every 5 seconds
            })
            .catch(err => vscode.window.showErrorMessage(err.message));

        if (progress)
            progress.report({
                increment: 100,
                message: 'Debug session ready!',
            });

        debuggerManager.restoreBreakpoints();
        debuggerSession.breakpointListenerDisposable =
        debuggerManager.listenForBreakpointChanges();

        const closeDisposable = vscode.window.onDidCloseTerminal(async (closedTerminal) => {
            if (closedTerminal === terminal) {
                if (this._connectionMonitor) {
                    clearInterval(this._connectionMonitor);
                    this._connectionMonitor = null;
                }

                if (debuggerSession.activeTerminal === terminal) {
                    debuggerSession.activeTerminal = null;
                }

                debuggerSession.isLldbConnected = false;
                debuggerSession.isSbpfDebugActive = false;

                if (debuggerSession.breakpointListenerDisposable) {
                    debuggerSession.breakpointListenerDisposable.dispose();
                    debuggerSession.breakpointListenerDisposable = null;
                }

                // Optionally dispose the listener if you only care about this terminal
                closeDisposable.dispose();
            }
        });
    }

    // Helper to remove all breakpoints except the one provided
    _keepOnlyBreakpoint(bpObject) {
        const allBreakpoints = vscode.debug.breakpoints;
        const breakpointsToRemove = allBreakpoints.filter(bp => bp !== bpObject);
        
        if (breakpointsToRemove.length > 0) {
            vscode.debug.removeBreakpoints(breakpointsToRemove);
        }
    }

    // Helper to delete the target/deploy files if they exist, so i will ensure that we are going to use the SBF V1 compiled SBF files
    _deleteIfExists(filePath) {
        if (filePath && fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    }

    async connectToTcpPort(delayMs = 1000) {
        return new Promise((resolve) => {
            // Check if terminal was closed
            const terminal = getTerminalByName('Solana LLDB Debugger');
            if (!terminal) {
                return resolve(false);
            }

            // Always try to connect, don't rely on isLldbConnected here
            debuggerSession.activeTerminal = terminal;

            // Check if already connected before trying to connect
            // prevent duplicate `gdb-remote` commands
            this.checkDebuggerConnection().then((alreadyConnected) => {
                if (alreadyConnected) {
                    return resolve(true);
                }
            

                terminal.sendText(`gdb-remote 127.0.0.1:${debuggerSession.tcpPort}`);
                
                // TODO: Ideally, we should find a way to detect when the connection is fully established, but currently no way to get info from child process(terminal from VS CODE API)
                // Wait a short moment for the connection to establish
                setTimeout(async () => {
                    try {
                        const connected = await this.checkDebuggerConnection();
                        resolve(connected);
                    } catch (err) {
                        vscode.window.showErrorMessage(`Error checking debugger connection: ${err.message}`);
                        resolve(false);
                    }
                }, delayMs);
            });
        })
    }

    async tryConnectToTcpPortWithRetry(timeoutMs = 60000, intervalMs = 1000) {
        const start = Date.now();
        let connected = false;

        while (!connected && (Date.now() - start < timeoutMs)) {
            try {
                await this.connectToTcpPort();
                if (debuggerSession.isLldbConnected) {
                    connected = true;
                    break;
                }
            } catch (err) {
                // Connection attempt failed, will retry
            }
            await new Promise(res => setTimeout(res, intervalMs));
        }

        if (!connected) {
            throw new Error('Failed to connect to debugger TCP port within timeout.');
        }
    }

    // Periodically checks the debugger TCP port and reconnects if disconnected
    startConnectionMonitor(intervalMs = 5000) {
        if (this._connectionMonitor) {
            clearInterval(this._connectionMonitor);
        }

        this._connectionMonitor = setInterval(async () => {
            const wasConnected = debuggerSession.isLldbConnected;

            await this.checkDebuggerConnection();
            if (!debuggerSession.isLldbConnected && wasConnected) {
                console.warn('Debugger TCP port disconnected. Attempting to reconnect...');
                try {
                    // Trigger the reconnect logic with the timeout
                    await this.tryConnectToTcpPortWithRetry();
                } catch (err) {
                    vscode.window.showErrorMessage('Failed to reconnect to debugger TCP port.');
                }
            }
        }, intervalMs);
    }

    // Checks if the debugger TCP port is still connected
    async checkDebuggerConnection() {
        return new Promise((resolve) => {
            const port = debuggerSession.tcpPort;
            exec(
                `netstat -nat | grep -E '[:|.]${port}\\b' | grep 'ESTA' | wc -l`,
                { cwd: this.workspaceFolder },
                (err, stdout, stderr) => {
                    if (stdout.trim() === '2') {
                        debuggerSession.isLldbConnected = true;
                    } else {
                        debuggerSession.isLldbConnected = false;
                    }
                    resolve(debuggerSession.isLldbConnected);
                }
            );
        });
    }
}

module.exports = {
    SbpfV1BuildStrategy,
};

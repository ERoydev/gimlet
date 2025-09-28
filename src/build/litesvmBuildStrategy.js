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
const net = require('net');

class litesvmBuildStrategy extends BaseBuildStrategy {
    constructor(
        workspaceFolder,
        packageName,
        depsPath,
        buildCommand = buildCommands.SBF_V1_DEBUG_TOOLS151
    ) {
        super(workspaceFolder, packageName, depsPath);
        this.buildCommand = buildCommand;
    }

    static get BUILD_TYPE() {
        return 'V1';
    }

    get buildType() {
        return this.constructor.BUILD_TYPE;
    }

    async build(progress) {
        // TODO: Make this into util and reuse it accordingly through all places where this is used
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
                `cargo-build-sbf --tools-version v1.51 --debug --arch v1`,
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

    async startLitesvmVmWithDebugger(bpObject) {
        this._keepOnlyBreakpoint(bpObject);

        return new Promise((resolve) => {
            // This testProcess have to be stopped when i want to start it again, instead of leaving it running in the background
            // I can do that by keeping a reference to the process and killing it when needed
            const testProcess = exec(
                // every child process inherit this ENV variable all the way to the 
                `VM_DEBUG_PORT=${debuggerSession.tcpPort} cargo test -- --nocapture`, // I step ENV variable, the proceess that i run it will inherit the env var
                { cwd: this.workspaceFolder },
                (err, stdout, stderr) => {
                    if (err) {
                        vscode.window.showErrorMessage(
                            `Test environment setup error: ${stderr}`
                        );
                        resolve();
                        return;
                    }
                }
            );

            // listen for output to detect when gdbstub is ready
            // Helper to handle both stdout and stderr
            const handleDebuggerReady = async (data) => {
                const output = data.toString();
                console.log(output);

                // This handles when we have open TCP port
                if (output.includes('Waiting for a Debugger connection on')) {                    
                    await this.connectToTcpPort();
                    resolve(true);
                }

                // else if (output.includes('Client disconnected')) {
                //     debuggerSession.isLldbConnected = false; // Reset the connection status
                // }

                // else if (output.includes("Debugger connected from")) {
                //     setTimeout(() => {
                //         this._sendContinueToDebuggerTerminal();
                //         resolve(true);
                //     }, 1000);
                // }

                // else if (output.includes('error: test failed, to rerun pass')) {
                //     vscode.window.showInformationMessage("Debugging session ended.");
                //     // TODO: This works fine for now, but ideally i should have a better way to handle this
                //     // When for some reason the test fails, i just invoke this function again until the function doesn't fail
                //     // Problem if something else goes wrong, it will be an infinite loop
                //     debuggerSession.isLldbConnected = false;
                //     // this.startLitesvmVmWithDebugger(bpObject);
                // }
            };
            testProcess.stderr.on('data', handleDebuggerReady);
        });
    }

    async connectToTcpPort() {
        const terminal = getTerminalByName('Solana LLDB Debugger');
        
        if (debuggerSession.isLldbConnected) {
            terminal.sendText('process detach'); // Detach from the previous process if already connected
            debuggerSession.isLldbConnected = false; // Reset the connection status
        }
        
        if (terminal && !debuggerSession.isLldbConnected) {
            debuggerSession.activeTerminal = terminal;
            debuggerSession.isLldbConnected = true; // Set the connection status to true
            console.log('LLDB connection status from TCP PORT FUNCTION:', debuggerSession.isLldbConnected);
            terminal.sendText(`gdb-remote 127.0.0.1:${debuggerSession.tcpPort}`); // Connect to the gdbstub TCP port to litesvm VM
        }
    }

    async setupDebugger(progress) {
        if (!fs.existsSync(this.depsPath)) {
            vscode.window.showErrorMessage(
                `Executable not found: ${this.depsPath}`
            );
            return;
        }

        fs.readdir(this.depsPath, (readDirErr, files) => {
            if (readDirErr) {
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

            const terminal = vscode.window.createTerminal(
                'Solana LLDB Debugger'
            );
            debuggerManager.setTerminal(terminal);
            debuggerManager.setBreakpointStrategy(
                LldbDebuggerManager.lineNumberStrategy
            ); // Set to line number strategy

            terminal.show();
            terminal.sendText('solana-lldb');
            terminal.sendText(`target create "${executablePath}"`);

            if (progress)
                progress.report({
                    increment: 100,
                    message: 'Debug session ready!',
                });

            debuggerManager.restoreBreakpoints();
            debuggerSession.breakpointListenerDisposable =
                debuggerManager.listenForBreakpointChanges();

            terminal.onDidClose(() => {
                if (debuggerSession.activeTerminal === terminal) {
                    debuggerSession.activeTerminal = null;
                }
            });
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

    _sendContinueToDebuggerTerminal() {
        const terminal = getTerminalByName('Solana LLDB Debugger');
        console.log('LLDB connection status from Continue function:', debuggerSession.isLldbConnected);
        if (terminal && debuggerSession.isLldbConnected) {
            terminal.sendText('continue');
        } else {
            vscode.window.showErrorMessage('Debugger terminal not found or not connected.');
        }
    }

    // Helper to delete the target/deploy files if they exist, so i will ensure that we are going to use the SBF V1 compiled SBF files
    _deleteIfExists(filePath) {
        if (filePath && fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    }

    async waitForPort(port, host, timeout = 1000, interval = 2000) {
        return new Promise((resolve, reject) => {
            const start = Date.now();

            function tryConnect() {
                const socket = new net.Socket();

                socket.setTimeout(timeout);

                socket.once('connect', () => {
                    socket.destroy();
                    resolve(true);
                });

                socket.once('timeout', () => {
                    socket.destroy();
                    retry();
                });

                socket.once('error', () => {
                    socket.destroy();
                    retry();
                });

                function retry() {
                    if (Date.now() - start > timeout) {
                        reject(new Error('Timeout waiting for port ' + port));
                    } else {
                        setTimeout(tryConnect, interval);
                    }
                }

                socket.connect(port, host);
            }

        tryConnect();
        });
    }
}

module.exports = {
    litesvmBuildStrategy,
};

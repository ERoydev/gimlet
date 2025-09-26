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
                `cargo test -- --nocapture`,
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

            let debuggerConnected = false;

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

                if (output.includes("Debugger connected from")) {
                    setTimeout(() => {
                        this._sendContinueToDebuggerTerminal();
                        resolve(true);
                    }, 1000);
                }

                if (output.includes('error: test failed, to rerun pass')) {
                    vscode.window.showInformationMessage("Debugging session ended.");
                    if (testProcess) {
                        testProcess.kill();
                    }
                }
            };

            testProcess.stderr.on('data', handleDebuggerReady);
        });
    }

    async connectToTcpPort() {
        const terminal = getTerminalByName('Solana LLDB Debugger');
    
        if (debuggerSession.isLldbConnected) {
            terminal.sendText('process detach'); // Detach from the previous process if already connected
        }
        
        if (terminal) {
            debuggerSession.activeTerminal = terminal;
            terminal.sendText(`gdb-remote 127.0.0.1:1234`); // Connect to the gdb server that agave-ledger-tool started on
            debuggerSession.isLldbConnected = true; // Set the connection status to true
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
            // terminal.sendText("gdb-remote 127.0.0.1:1234")
            // this.connectToTcpPort();
            // pollDebuggerConnection(1234);

            if (progress)
                progress.report({
                    increment: 100,
                    message: 'Debug session ready!',
                });

            // debuggerManager.restoreBreakpoints();
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
        if (terminal) {
            terminal.sendText('continue');
        } else {
            vscode.window.showErrorMessage('Debugger terminal not found');
        }
    }

    _deleteIfExists(filePath) {
        if (filePath && fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    }
}

module.exports = {
    litesvmBuildStrategy,
};

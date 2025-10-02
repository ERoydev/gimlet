const BaseBuildStrategy = require('./baseBuildStrategy');
const debuggerSession = require('../state');
const vscode = require('vscode');
const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');
const os = require('os');
const buildCommands = require('./buildCommands');
const { debuggerManager } = require('../debuggerManager');

class SbpfV0BuildStrategy extends BaseBuildStrategy {
    constructor(
        workspaceFolder,
        packageName,
        depsPath,
        buildCommand = buildCommands.SBF_V0_DEBUG
    ) {
        super(workspaceFolder, packageName, depsPath);
        this.buildCommand = buildCommand;
    }

    static get BUILD_TYPE() {
        return 'V0';
    }

    get buildType() {
        return this.constructor.BUILD_TYPE;
    }

    async build(progress) {
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

                    try {
                        this.handleBuildOutput((terminal, executablePath) => {
                            resolve({ terminal, executablePath }); // callback that resolves the Promise with terminal and executablePath
                        }, progress);
                    } catch (e) {
                        vscode.window.showErrorMessage(`Error: ${e}`);
                        resolve();
                    }
                }
            );
        });
    }

    handleBuildOutput(callback, progress) {
        if (!fs.existsSync(this.depsPath)) {
            vscode.window.showErrorMessage(
                `Executable not found: ${this.depsPath}`
            );
            callback(null, null);
            return;
        }

        fs.readdir(this.depsPath, (readDirErr, files) => {
            if (readDirErr) {
                vscode.window.showErrorMessage(
                    `Error reading directory: ${readDirErr}`
                );
                callback(null, null);
                return;
            }

            const { executablePath } = this.findDebugExecutable(files);
            if (!executablePath) {
                vscode.window.showErrorMessage(`No debug executable found`);
                callback(null, null);
                return;
            }

            // Generate function address map first, then start LLDB and turn on the breakpoint logic
            this.setupFunctionAddressMap(executablePath).then(() => {
                const terminal = vscode.window.createTerminal(
                    'Solana LLDB Debugger'
                );
                debuggerManager.setTerminal(terminal);

                terminal.show();
                terminal.sendText('solana-lldb');
                terminal.sendText(`target create ${executablePath}`);

                // Give LLDB time to initialize before restoring breakpoints
                setTimeout(() => {
                    if (progress)
                        progress.report({
                            increment: 100,
                            message: 'Build complete!',
                        });
                    // This restores all breakpoints that were set in the source code, before starting the debugger
                    debuggerManager.restoreBreakpoints();
                    callback(terminal, executablePath);
                }, 1500);

                // This is the listener for breakpoint changes, that allows adding/removing breakpoints dynamically
                debuggerSession.breakpointListenerDisposable =
                    debuggerManager.listenForBreakpointChanges();

                terminal.onDidClose(() => {
                    if (debuggerSession.activeTerminal === terminal) {
                        debuggerSession.activeTerminal = null;
                    }
                });
            });
        });
    }

    setupFunctionAddressMap(executablePath) {
        return new Promise((resolve) => {
            debuggerSession.functionAddressMapPath = path.join(
                os.tmpdir(),
                BaseBuildStrategy.FUNCTION_ADDRESS_MAP_NAME
            );

            const functionMapCommand = `llvm-objdump -t ${executablePath} --demangle | grep ' F ' | awk '{print $1, $6}' > ${debuggerSession.functionAddressMapPath}`;

            exec(
                functionMapCommand,
                { cwd: this.workspaceFolder },
                (error, stdout, stderr) => {
                    if (error) {
                        vscode.window.showErrorMessage(
                            `Error generating function address map: ${stderr}`
                        );
                        resolve(false);
                        return;
                    }
                    console.log(
                        `Function address map generated: ${BaseBuildStrategy.FUNCTION_ADDRESS_MAP_NAME}`
                    );
                    resolve(true);
                }
            );
        });
    }
}

module.exports = {
    SbpfV0BuildStrategy,
};

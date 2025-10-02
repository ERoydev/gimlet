const vscode = require('vscode');
const os = require('os');
const path = require('path');
const fs = require('fs');
const debuggerSession = require('./state');
const { resolveGimletConfig } = require('./config');
const { findSolanaPackageName } = require('./projectStructure');
const buildCommands = require('./build/buildCommands');
const getFunctionNameAtLine = require('./utils/getFunctionNameAtLine');
const getTerminalByName = require('./utils/getTerminalByName');

const { CargoSbfBuildStrategy } = require('./build/CargoSbfBuildStrategy');
const { litesvmBuildStrategy } = require('./build/litesvmBuildStrategy');
const { debuggerManager } = require('./debuggerManager');

const { GimletCodeLensProvider } = require('./lens/GimletCodeLensProvider');


function getCommandPath(command) {
    const homeDir = os.homedir();
    const agaveLedgerToolPath = path.join(
        homeDir,
        '.local',
        'share',
        'solana',
        'install',
        'active_release',
        'bin',
        'agave-ledger-tool'
    );

    let solanalldbPath = path.join(
        homeDir,
        '.local',
        'share',
        'solana',
        'install',
        'active_release',
        'bin',
        'sdk',
        'sbf',
        'dependencies',
        'platform-tools',
        'llvm',
        'bin',
        'solana-lldb'
    );

    const customSolanalldbPath = vscode.workspace
        .getConfiguration('solanaDebugger')
        .get('solanaLldbPath');
    if (customSolanalldbPath) {
        solanalldbPath = customSolanalldbPath;
    }

    if (command.includes('agave-ledger-tool')) {
        return agaveLedgerToolPath;
    } else if (command.includes('solana-lldb')) {
        return solanalldbPath;
    } else {
        vscode.window.showErrorMessage(`Unknown command: ${command}`);
        return '';
    }
}

function runCommand(command, args = '') {
    const commandPath = getCommandPath(command);

    if (!commandPath) {
        vscode.window.showErrorMessage(
            `Command path for ${command} not found.`
        );
        return;
    }

    const terminal = vscode.window.createTerminal(`Run ${command}`);
    terminal.show();
    terminal.sendText(`${commandPath} ${args}`);
}

async function startSolanaDebugger() {
    const { workspaceFolder, depsPath } = await resolveGimletConfig();

    const projectFolderName = path.basename(workspaceFolder);

    debuggerSession.isLldbConnected = false; // Reset the connection status
    debuggerSession.selectedAnchorProgramName = null; // Reset the selected program name

    if (debuggerSession.breakpointListenerDisposable) {
        debuggerSession.breakpointListenerDisposable.dispose();
        debuggerSession.breakpointListenerDisposable = null;
    }

    debuggerSession.breakpointMap.clear();

    vscode.window.terminals.forEach((terminal) => {
        if (terminal.name === 'Solana LLDB Debugger') {
            terminal.dispose();
        }
    });

    if (!fs.existsSync(depsPath)) {
        vscode.window.showInformationMessage(
            'Target folder not found. Cargo is installing necessary tools.'
        );
    }

    const { packageName, isAnchor } =
        await findSolanaPackageName(workspaceFolder);
    debuggerSession.isAnchor = isAnchor;

    if (!packageName) {
        vscode.window.showErrorMessage(
            'Could not find package name in any Cargo.toml'
        );
        return;
    }

    // TODO: I should implement these in some kind of config where user sets how he wants to use Gimlet.
    // const buildStrategy = new CargoSbfBuildStrategy(
    //     debuggerSession.globalWorkspaceFolder,
    //     packageName,
    //     depsPath
    // );
    buildStrategy = new litesvmBuildStrategy(debuggerSession.globalWorkspaceFolder, packageName, depsPath);

    vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Building Solana program, setting up debugger...',
            cancellable: false,
        },
        async (progress) => {
            progress.report({ increment: 0, message: 'Starting build...' });

            try {
                if (buildStrategy.buildType === 'V1') {
                    // Compile the program with SBF V1, dynamic stack without optimizations
                    const buildResult = await buildStrategy.build(progress);
                    if (!buildResult) return;

                    // Setup the debugger in LLDB terminal
                    await buildStrategy.setupDebugger(progress);
                } else {
                    const result = await buildStrategy.build(progress);
                    if (!result) return;
                }
            } catch (err) {
                vscode.window.showErrorMessage(`Build failed: ${err.message}`);
            }
        }
    );
}

function reRunProcessLaunch() {
    const terminal = getTerminalByName('Solana LLDB Debugger');

    if (terminal) {
        debuggerSession.activeTerminal = terminal;
        terminal.sendText('continue'); // Resume the process in the LLDB debugger (process launch -- --nocapture)
    } else {
        vscode.window.showErrorMessage(
            'Solana LLDB Debugger terminal not found.'
        );
        startSolanaDebugger();
    }
}

// ============== VSCODE COMMANDS ==============
/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    // This line of code will only be executed once when your extension is activated
    console.log('Gimlet is now active!');

    // This is automated script to check dependencies for Gimlet
    const setupDisposable = vscode.commands.registerCommand(
        'extension.runGimletSetup',
        () => {
            const scriptPath = path.join(__dirname, 'scripts/gimlet-setup.sh');

            // Create a terminal to show the beautiful output
            const terminal = vscode.window.createTerminal('Gimlet Setup');
            terminal.show();
            terminal.sendText(`bash "${scriptPath}"`);
        }
    );

    context.subscriptions.push(setupDisposable);

    const disposable = vscode.commands.registerCommand(
        'extension.runAgaveLedgerTool',
        () => {
            vscode.window
                .showInputBox({ prompt: 'Enter agave-ledger-tool subcommand' })
                .then((subcommand) => {
                    if (subcommand) {
                        runCommand('agave-ledger-tool', subcommand);
                    } else {
                        vscode.window.showErrorMessage(
                            'No subcommand provided.'
                        );
                    }
                });
        }
    );

    context.subscriptions.push(disposable);

    const disposable2 = vscode.commands.registerCommand(
        'extension.runSolanaLLDB',
        () => {
            startSolanaDebugger();
        }
    );

    context.subscriptions.push(disposable2);

    const disposable3 = vscode.commands.registerCommand(
        'extension.reRunProcessLaunch',
        () => {
            reRunProcessLaunch();
        }
    );

    context.subscriptions.push(disposable3);

    const disposable4 = vscode.commands.registerCommand(
        'extension.runAgaveLedgerToolForBreakpoint',
        () => {
            runAgaveLedgerToolForBreakpoint();
        }
    );

    // Register provider for the Rust files
    // TODO: extend it to handle ts, js tests too written on `litesvm-node`
    const codeLensDisposable = vscode.languages.registerCodeLensProvider(
        { language: 'rust' },
        new GimletCodeLensProvider()
    );

    const sbpfDebugDisposable = vscode.commands.registerCommand('gimlet.debugAtLine', async () => {
        
        try {
            await startSolanaDebugger();
            await new Promise(resolve => setTimeout(resolve, 5000));

            const originalValue = process.env.VM_DEBUG_PORT;

            // ENV for SBPF VM, this enables litesvm to create a debug server on this port for remote debugging
            process.env.VM_DEBUG_PORT = debuggerSession.tcpPort.toString();

            try {
                // rust-analyzer command to debug reusing the client and runnables it creates initially
                await vscode.commands.executeCommand("rust-analyzer.debug");
            } finally {
                // Cleanup strategy for the ENV after command execution
                if (originalValue === undefined) {
                    delete process.env.VM_DEBUG_PORT;
                } else {
                    process.env.VM_DEBUG_PORT = originalValue;
                }
            }
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to debug with Gimlet: ${err.message}`);
        }
    })

    vscode.debug.onDidTerminateDebugSession(session => {
        const lldbTerminal = debuggerManager.getTerminal();

        if (lldbTerminal) {
            lldbTerminal.dispose();

        }
    })

    // Add all disposables to context subscriptions
    context.subscriptions.push(
        setupDisposable,
        agaveLedgerDisposable,
        solanaLLDBDisposable,
        reRunProcessDisposable,
        agaveBreakpointDisposable,
        codeLensDisposable,
        sbpfDebugDisposable
    );
}

function deactivate() {
    if (debuggerSession.breakpointListenerDisposable) {
        debuggerSession.breakpointListenerDisposable.dispose();
        debuggerSession.breakpointListenerDisposable = null;
    }
    debuggerSession.activeTerminal = null;

    if (
        debuggerSession.functionAddressMapPath &&
        fs.existsSync(debuggerSession.functionAddressMapPath)
    ) {
        fs.unlinkSync(debuggerSession.functionAddressMapPath); // Delete the function address map file
        debuggerSession.functionAddressMapPath = null; // Clear the path after deletion
    }
}

module.exports = {
    activate,
    deactivate,
};

// TODO: LiteSVM debugging approach
function debugBreakpoint() {
    const lldbTerminal = getTerminalByName('Solana LLDB Debugger');
    if (!lldbTerminal) {
        vscode.window.showErrorMessage(
            'Solana LLDB Debugger terminal not found. Use `Run Solana LLDB` from Command Pallette to start it!'
        );
        return;
    }

    debuggerManager.selectBreakpoint(createLitesvmVMInstance);
}

async function createLitesvmVMInstance(bpObject, functionName) {
    await buildStrategy.startLitesvmVmWithDebugger(bpObject);
}

// ============== UTILITIES ==============
function runAgaveLedgerToolForBreakpoint() {
    // get all breakpoints
    const latestTerminal = getTerminalByName('Agave Ledger Tool');

    if (latestTerminal) {
        latestTerminal.dispose(); // closes the previous terminal if it exists
    }

    let lldbTerminal = getTerminalByName('Solana LLDB Debugger');
    if (!lldbTerminal) {
        vscode.window.showErrorMessage(
            'Solana LLDB Debugger terminal not found. Use `Run Solana LLDB` from Command Pallette to start it!'
        );
        return;
    }

    debuggerManager.selectBreakpoint(runAgaveLedgerTool);
}

// This function run the agave-ledger-tool with the provided parameters
function runAgaveLedgerTool(
    bpObject,
    instructionName,
) {
    const inputPath = debuggerSession.globalInputPath;
    const bpfCompiledPath = debuggerSession.globalBpfCompiledPath;
    
    // I want if its multi program anchor project, to use path like `input/program_name/instruction_name.json`
    // If its single program anchor project, then use path like `input/instruction_name.json
    let instructionInput = `${inputPath}/${instructionName}.json`;
    if (debuggerSession.selectedAnchorProgramName) {
        instructionInput = `${inputPath}/${debuggerSession.selectedAnchorProgramName}/${instructionName}.json`;
    }

    if (!fs.existsSync(instructionInput)) {
        vscode.window.showErrorMessage(
            `Instruction input file not found: ${instructionInput}`
        );
        return;
    }

    const agaveLedgerToolCommand = `agave-ledger-tool program run ${bpfCompiledPath} --ledger ledger --mode debugger -i ${instructionInput}`;

    const agaveTerminal = vscode.window.createTerminal('Agave Ledger Tool');
    agaveTerminal.show();
    agaveTerminal.sendText(agaveLedgerToolCommand);

    // Connect to the Solana LLDB Debugger terminal
    // Wait some time before connecting LLDB to ensure agave-ledger-tool is ready
    setTimeout(() => {
        connectSolanaLLDBToAgaveLedgerTool();

        // Remove and re-add the specific breakpoint
        // Note: Implemented because of the `agave-ledger-tool`, needs to set the breakpoint after i have connected to the gdb-remote server
        vscode.debug.removeBreakpoints([bpObject]);
        setTimeout(() => {
            vscode.debug.addBreakpoints([bpObject]);
            console.log('Breakpoint re-added:', bpObject.location);
        }, 1000); // small delay to ensure removal is processed
    }, 8000);
}

function connectSolanaLLDBToAgaveLedgerTool() {
    const terminal = getTerminalByName('Solana LLDB Debugger');

    if (debuggerSession.isLldbConnected) {
        terminal.sendText('process detach'); // Detach from the previous process if already connected
    }

    if (terminal) {
        debuggerSession.activeTerminal = terminal;
        terminal.sendText(`gdb-remote 127.0.0.1:9001`); // Connect to the gdb server that agave-ledger-tool started on
        debuggerSession.isLldbConnected = true; // Set the connection status to true
    }
}
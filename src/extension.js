const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

const gimletConfigManager  = require('./config');

const { findSolanaPackageName } = require('./projectStructure');

const { SbpfV1BuildStrategy } = require('./build/SbpfV1BuildStrategy');
const { GimletCodeLensProvider } = require('./lens/GimletCodeLensProvider');

const { lldbSettingsManager, rustAnalyzerSettingsManager, editorSettingsManager } = require('./managers/VsCodeSettingsManager');

const debuggerSession = require('./state');
const portManager = require('./managers/PortManager')
const { debugConfigManager } = require('./managers/DebugConfigManager');

async function SbpfCompile() {
    const { depsPath } = await gimletConfigManager.resolveGimletConfig();

    if (!fs.existsSync(depsPath)) {
        vscode.window.showInformationMessage(
            'Target folder not found. Cargo is installing necessary tools.'
        );
    }

    const programNamesList = await findSolanaPackageName(debuggerSession.globalWorkspaceFolder);
    debuggerSession.executables = programNamesList;

    if (programNamesList.length == 0 || !programNamesList) {
        vscode.window.showErrorMessage(
            'Could not find package name in any Cargo.toml'
        );
        return;
    }

    // TODO: Implement a dispatcher for different build strategies
    debuggerSession.buildStrategy = new SbpfV1BuildStrategy(debuggerSession.globalWorkspaceFolder, depsPath, programNamesList);

    return vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Building Solana program, setting up debugger...',
            cancellable: false,
        },
        async (progress) => {
            progress.report({ increment: 0, message: 'Starting build...' });

            try {
                const buildResult = await debuggerSession.buildStrategy.build(progress);
                if (!buildResult) return;
            } catch (err) {
                vscode.window.showErrorMessage(`Build failed: ${err.message}`);
            }
        }
    );
}

// ============== VSCODE COMMANDS ==============
/**
 * @param {vscode.ExtensionContext} context
 */
async function activate(context) {

    gimletConfigManager.ensureGimletConfig();
    gimletConfigManager.watchGimletConfig(context);

    // Set necessary VS Code settings for optimal debugging experience
    rustAnalyzerSettingsManager.set('debug.engine', 'vadimcn.vscode-lldb');
    editorSettingsManager.set('codeLens', true);
    

    // This is automated script to check dependencies for Gimlet
    const setupDisposable = vscode.commands.registerCommand(
        'extension.runGimletSetup',
        () => {
            const scriptPath = path.join(context.extensionPath, 'scripts/gimlet-setup.sh');

            // Create a terminal to show the output
            const terminal = vscode.window.createTerminal('Gimlet Setup');
            terminal.show();
            terminal.sendText(`bash "${scriptPath}"`);
        }
    );

    // Register provider for the Rust files
    const codeLensDisposable = vscode.languages.registerCodeLensProvider(
        [{ language: 'rust' }, { language: 'typescript' }],
        new GimletCodeLensProvider()
    );

    // Listener to clean up after debug session ends
    vscode.debug.onDidTerminateDebugSession(session => {
        if (session.id === debuggerSession.debugSessionId) {
            debuggerSession.debugSessionId = null;
            lldbSettingsManager.restore('library');
        }
    });

    // Only captures output sent to the Debug Console (via the debug adapter).
    // Used to extract the program hash of the program that litesvm starts a VM for.
    vscode.debug.registerDebugAdapterTrackerFactory('*', {
        // Its important to set in rust-analyzer.debug.engineSettings the lldb.terminal to external
        createDebugAdapterTracker(session) {
            if (session.type === 'lldb' || session.type === 'rust-analyzer') {
            return {
                // Have in min here i can implement `onWillStartSession` and `onWillStopSession` to manage states if needed
                onDidSendMessage(message) {
                if (message.type === 'event' && message.event === 'output') {
                    const body = message.body;
                    const output = body.output || '';

                    // Regex to match a SHA256 hash (64 hex characters)
                    const shaMatch = output.match(/[a-f0-9]{64}/i);
                    if (shaMatch) {
                        const programHash = shaMatch[0];
                        console.log(`SHA256: ${programHash}`);
                        debuggerSession.currentProgramHash = programHash;
                    }
                }
                },
            };
            }
            return undefined;
        }
    });
        
    const sbpfDebugDisposable = vscode.commands.registerCommand('gimlet.debugAtLine', async (document, functionName) => {
        if (debuggerSession.debugSessionId) {
            vscode.window.showErrorMessage('A Gimlet debug session is already running. Please stop the current session before starting a new one.');
            return;
        }
        const language = document.languageId;

        // Check if user started a `test case` specified in the config as a CPI
        const isCpi = Array.isArray(debuggerSession.cpi) &&
            debuggerSession.cpi.some(item => item.test_name === functionName);

        try {
            await SbpfCompile();
            await new Promise(resolve => setTimeout(resolve, 500));

            const originalValue = process.env.VM_DEBUG_PORT;
            // ENV for SBPF VM, this enables litesvm to create a debug server on this port for remote debugging
            process.env.VM_DEBUG_PORT = debuggerSession.tcpPort.toString();

            // remove the lldb.library setting to allow rust-analyzer/typescript test debugger to work properly
            await lldbSettingsManager.disable('library');

            try {
                if (language == 'rust') {
                    const debugListener = vscode.debug.onDidStartDebugSession(session => {
                        if (session.type === 'lldb' || session.type === 'rust-analyzer') {
                            debuggerSession.debugSessionId = session.id;
                        }
                    });
                    // rust-analyzer command to debug reusing the client and runnables it creates initially
                    const result = await vscode.commands.executeCommand("rust-analyzer.debug");
                    debugListener.dispose();
                    
                    if (!result) {
                        vscode.window.showErrorMessage('Failed to start debug session. Please ensure you have selected a runnable in the rust-analyzer prompt.');
                        return;
                    }

                    // TODO: Fix it later
                    await new Promise(resolve => setTimeout(resolve, 5000));

                    const programName = debuggerSession.programHashToProgramName[debuggerSession.currentProgramHash];

                    await lldbSettingsManager.set('library', debuggerSession.lldbLibrary);
                    // // When we have multiple programs, we need to start multiple debug sessions
                    await startDebugSessionsForPrograms(isCpi, functionName, programName);
                } else if (language == 'typescript') {
                    // TODO: Test for typescript
                    // TODO: Implement everything for typescript
                    const launchConfig = debugConfigManager.getTypescriptTestLaunchConfig();
                    vscode.debug.startDebugging(
                        vscode.workspace.workspaceFolders[0], // or undefined for current folder
                        launchConfig
                    );

                    await lldbSettingsManager.set('library', debuggerSession.lldbLibrary);
                    await startDebugSessionsForPrograms(isCpi, functionName, programName);
                }
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
    });
        
    // Add all disposables to context subscriptions
    context.subscriptions.push(
        setupDisposable,
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

    lldbSettingsManager.disable('library');
    rustAnalyzerSettingsManager.restore('debug.engine');
    editorSettingsManager.restore('codeLens'); 
}


async function startDebugSessionsForPrograms(isCpi, functionName, programName) {
    if (isCpi) {
        const cpiProgramObject = debuggerSession.cpi.find(item => item.test_name === functionName);
        if (!cpiProgramObject) {
            vscode.window.showErrorMessage('CPI configuration not found for the selected test.');
            return;
        }
        
        const programCpiFlow = cpiProgramObject.flow;

        for (const currentProgramName of programCpiFlow) {
            const currentTcpPort = debuggerSession.tcpPort;
            debuggerSession.incrementTcpPort(); // Increment TCP port for the next nested VM debug session in CPI flow

            const launchConfig = debugConfigManager.getLaunchConfigForSolanaLldb(currentTcpPort, currentProgramName);
            if (!launchConfig) continue;

            portManager.waitAndStartDebug(vscode.workspace.workspaceFolders[0], launchConfig, currentTcpPort);
        }
    } else {
        const currentTcpPort = debuggerSession.tcpPort;
        // No increment here, as we only start one session
        const launchConfig = debugConfigManager.getLaunchConfigForSolanaLldb(currentTcpPort, programName);
        if (!launchConfig) return;

        portManager.waitAndStartDebug(vscode.workspace.workspaceFolders[0], launchConfig, currentTcpPort);
    }
}

module.exports = {
    activate,
    deactivate,
};


const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

const gimletConfigManager  = require('./config');
const { globalState } = require('./state/globalState');
const { createSessionState } = require('./state/sessionState');

const { findSolanaPackageName } = require('./projectStructure');

const { SbpfV1BuildStrategy } = require('./build/sbpfV1BuildStrategy');
const { GimletCodeLensProvider } = require('./lens/gimletCodeLensProvider');

const { lldbSettingsManager, rustAnalyzerSettingsManager, editorSettingsManager } = require('./managers/vscodeSettingsManager');
const portManager = require('./managers/portManager')
const { debugConfigManager } = require('./managers/debugConfigManager');

const { setDebuggerSession, clearDebuggerSession } = require('./managers/sessionManager');

let debuggerSession = null;

async function SbpfCompile() {
    const { depsPath } = await gimletConfigManager.resolveGimletConfig();

    if (!fs.existsSync(depsPath)) {
        vscode.window.showInformationMessage(
            'Target folder not found. Cargo is installing necessary tools.'
        );
    }

    const programNamesList = await findSolanaPackageName(globalState.globalWorkspaceFolder);
    debuggerSession.executables = programNamesList;

    if (programNamesList.length == 0 || !programNamesList) {
        vscode.window.showErrorMessage(
            'Could not find package name in any Cargo.toml'
        );
        return;
    }

    // TODO: Implement a dispatcher for different build strategies if decide to add more in the future
    debuggerSession.buildStrategy = new SbpfV1BuildStrategy(globalState.globalWorkspaceFolder, depsPath, programNamesList);

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

    // Listener to handle when debug ends and extension can clean up
    vscode.debug.onDidTerminateDebugSession(session => {
        if (session.id === debuggerSession.debugSessionId) {
            portManager.cleanup(); // Clean up any active port polling when session ends
            cleanupDebuggerSession();
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
                    // TODO: Fix the regex to be more specific
                    const shaMatch = output.match(/[a-f0-9]{64}/i);
                    if (shaMatch) {
                        const programHash = shaMatch[0];
                        debuggerSession.currentProgramHash = programHash;
                    }
                }
                },
            };
            }
            return undefined;
        }
    });
        
    const sbpfDebugDisposable = vscode.commands.registerCommand('gimlet.debugAtLine', async (document) => {
        // Prevent starting a new session if one is already running
        if (debuggerSession && debuggerSession.debugSessionId) {
            vscode.window.showErrorMessage('A Gimlet debug session is already running. Please stop the current session before starting a new one.');
            return;
        }

        // Always create a new session state for a new debug session
        const sessionStateInstance = createSessionState();
        setDebuggerSession(sessionStateInstance);
        debuggerSession = sessionStateInstance;
        
        debuggerSession.tcpPort = globalState.tcpPort;
        const language = document.languageId;

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
                        // Literally this is the place where the debugging starts
                        if (session.type === 'lldb' || session.type === 'rust-analyzer') {
                            debuggerSession.debugSessionId = session.id;
                        }
                    });
                    
                    const result = await startRustAnalyzerDebugSession();
                    debugListener.dispose();
                    
                    if (!result) {
                        vscode.window.showErrorMessage('Failed to start debug session. Please ensure you have selected a runnable in the rust-analyzer prompt.');
                        return;
                    }

                    await lldbSettingsManager.set('library', globalState.lldbLibrary);
                    // When we have multiple programs, we need to start multiple debug sessions
                    await startPortDebugListeners();
                } else if (language == 'typescript') {
                    // typescript debug command to run the tests 
                    debugConfigManager.spawnAnchorTestProcess();

                    await lldbSettingsManager.set('library', globalState.lldbLibrary);
                    await startPortDebugListeners();
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
    cleanupDebuggerSession();
}


async function startPortDebugListeners() {
    const initialTcpPort = debuggerSession.tcpPort;
    const CPI_PORT_COUNT = 4; // Solana currently supports up to 4 for CPI

    const ports = [];
    for (let i = 0; i < CPI_PORT_COUNT; i++) {
        ports.push(initialTcpPort + i);
    }

    debuggerSession.tcpPort += CPI_PORT_COUNT;
    portManager.listenAndStartDebugForPorts(ports);
}

function cleanupDebuggerSession() {
    debuggerSession = null;
    clearDebuggerSession();

    lldbSettingsManager.disable('library');
    // rustAnalyzerSettingsManager.disable('debug.engine');
    rustAnalyzerSettingsManager.disable('debug.engineSettings');
    rustAnalyzerSettingsManager.disable('runnables.extraTestBinaryArgs');
    editorSettingsManager.restore('codeLens'); 
}

async function startRustAnalyzerDebugSession() {
    rustAnalyzerSettingsManager.set('debug.engineSettings', {
        "lldb": {
            "terminal": "external"
        }
    });
    rustAnalyzerSettingsManager.set('runnables.extraTestBinaryArgs', [
        "--show-output",
        "--nocapture"
    ]);

    // rust-analyzer command to debug reusing the client and runnables it creates initially
    return await vscode.commands.executeCommand("rust-analyzer.debug");
}

module.exports = {
    activate,
    deactivate,
};


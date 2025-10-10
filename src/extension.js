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

async function SbpfCompile(programName) {
    const { workspaceFolder, depsPath } = await gimletConfigManager.resolveGimletConfig();

    debuggerSession.selectedAnchorProgramName = null; // Reset the selected program name

    if (!fs.existsSync(depsPath)) {
        vscode.window.showInformationMessage(
            'Target folder not found. Cargo is installing necessary tools.'
        );
    }

    const { packageName, isAnchor } =
        await findSolanaPackageName(workspaceFolder, programName);
    debuggerSession.isAnchor = isAnchor;

    if (!packageName) {
        vscode.window.showErrorMessage(
            'Could not find package name in any Cargo.toml'
        );
        return;
    }

    debuggerSession.buildStrategy = new SbpfV1BuildStrategy(debuggerSession.globalWorkspaceFolder, packageName, depsPath);

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

    vscode.debug.onDidTerminateDebugSession(session => {
        if (session.id === debuggerSession.debugSessionId) {
            debuggerSession.debugSessionId = null;
            lldbSettingsManager.restore('library');
        }
    });

    const sbpfDebugDisposable = vscode.commands.registerCommand('gimlet.debugAtLine', async (document, functionName, programName) => {
        if (debuggerSession.debugSessionId) {
            vscode.window.showErrorMessage('A Gimlet debug session is already running. Please stop the current session before starting a new one.');
            return;
        }

        const language = document.languageId;
        try {
            await SbpfCompile(programName);
            await new Promise(resolve => setTimeout(resolve, 500));

            const originalValue = process.env.VM_DEBUG_PORT;
            // ENV for SBPF VM, this enables litesvm to create a debug server on this port for remote debugging
            process.env.VM_DEBUG_PORT = debuggerSession.tcpPort.toString();

            // remove the lldb.library setting to allow rust-analyzer to work properly
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

                    await lldbSettingsManager.set('library', debuggerSession.lldbLibrary);
                    const launchConfig = debugConfigManager.getLaunchConfigForSolanaLldb();
                    if (!launchConfig) return;

                    portManager.waitAndStartDebug(vscode.workspace.workspaceFolders[0], launchConfig);
                } else if (language == 'typescript') {
                    const launchConfig = debugConfigManager.getTypescriptTestLaunchConfig();
                    vscode.debug.startDebugging(
                        vscode.workspace.workspaceFolders[0], // or undefined for current folder
                        launchConfig
                    );

                    await lldbSettingsManager.set('library', debuggerSession.lldbLibrary);

                    const solanaLLdbLaunchConfig = debugConfigManager.getLaunchConfigForSolanaLldb();
                    if (!solanaLLdbLaunchConfig) return;
                    
                    portManager.waitAndStartDebug(vscode.workspace.workspaceFolders[0], solanaLLdbLaunchConfig);
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

    lldbSettingsManager.restore('library');
    rustAnalyzerSettingsManager.restore('debug.engine');
    editorSettingsManager.restore('codeLens');
}

module.exports = {
    activate,
    deactivate,
};


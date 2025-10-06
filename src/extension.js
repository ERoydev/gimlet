const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const toml = require('toml');

const gimletConfigManager  = require('./config');

const { findSolanaPackageName } = require('./projectStructure');

const { SbpfV1BuildStrategy } = require('./build/SbpfV1BuildStrategy');
const { GimletCodeLensProvider } = require('./lens/GimletCodeLensProvider');

const { lldbSettingsManager, rustAnalyzerSettingsManager, editorSettingsManager } = require('./VsCodeSettingsManager');

const debuggerSession = require('./state');
const portManager = require('./PortManager')


async function SbpfCompile() {
    const { workspaceFolder, depsPath } = await gimletConfigManager.resolveGimletConfig();

    debuggerSession.selectedAnchorProgramName = null; // Reset the selected program name

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

    const sbpfDebugDisposable = vscode.commands.registerCommand('gimlet.debugAtLine', async (document, functionName) => {
        if (debuggerSession.debugSessionId) {
            vscode.window.showErrorMessage('A Gimlet debug session is already running. Please stop the current session before starting a new one.');
            return;
        }

        const available = await portManager.isPortAvailable(debuggerSession.tcpPort);
        if (!available) {
            vscode.window.showErrorMessage(
                `Port ${debuggerSession.tcpPort} is already in use by another service. Please choose a different port in your Gimlet config.`
            );
            return; // Abort debug setup
        }

        const language = document.languageId;
        try {
            await SbpfCompile();
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
                    const launchConfig = getLaunchConfigForSolanaLldb();
                    portManager.waitAndStartDebug(vscode.workspace.workspaceFolders[0], launchConfig);

                } else if (language == 'typescript') {
                    const launchConfig = getTypescriptTestLaunchConfig();
                    vscode.debug.startDebugging(
                        vscode.workspace.workspaceFolders[0], // or undefined for current folder
                        launchConfig
                    );

                    await lldbSettingsManager.set('library', debuggerSession.lldbLibrary);

                    const solanaLLdbLaunchConfig = getLaunchConfigForSolanaLldb();
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

function getTestRunnerFromAnchorToml(workspaceFolder) {
    const anchorTomlPath = path.join(workspaceFolder, 'Anchor.toml');
    if (!fs.existsSync(anchorTomlPath)) {
        return null;
    }
    const tomlContent = fs.readFileSync(anchorTomlPath, 'utf8');
    const config = toml.parse(tomlContent);

    if (config.scripts && config.scripts.test) {
        // Example: "yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts"
        const testScript = config.scripts.test;
        // Extract runner and args (simple heuristic)
        const match = testScript.match(/(?:yarn run |npx )?([^\s]+)(.*)/);
        if (match) {
            const runner = match[1]; // e.g., ts-mocha
            const args = match[2].trim().split(/\s+/); // split args
            return { runner, args };
        }
    }
    return null;
}

function getTypescriptTestLaunchConfig() {
    const workspaceFolder = debuggerSession.globalWorkspaceFolder;
    const runnerInfo = getTestRunnerFromAnchorToml(workspaceFolder);

    let program;
    if (runnerInfo) {
        // Try to resolve runner path in node_modules/.bin
        program = path.join(workspaceFolder, 'node_modules', runnerInfo.runner, 'bin', runnerInfo.runner);
    } else {
        // Fallback to ts-mocha
        program = path.join(workspaceFolder, 'node_modules/ts-mocha/bin/ts-mocha');
    }

    const launchConfig = {
        type: "node",
        request: "launch",
        name: "SBPF Debug TypeScript Tests",
        program,
        args: [
            "tests/**/*.ts"
        ], 
        cwd: "${workspaceFolder}",
        env: {
            "VM_DEBUG_PORT": debuggerSession.tcpPort.toString()
        },
        internalConsoleOptions: "openOnSessionStart",
        console: "integratedTerminal"
    };
    return launchConfig;
}

function getLaunchConfigForSolanaLldb() {
    const launchConfig = {
        type: "lldb",
        request: "launch",
        name: "Sbpf Debug",
        targetCreateCommands: [
            `target create ${debuggerSession.globalExecutablePath}`,
        ],
        processCreateCommands: [`gdb-remote 127.0.0.1:${debuggerSession.tcpPort}`],
    };
    return launchConfig
}

module.exports = {
    activate,
    deactivate,
};


const vscode = require('vscode');
const path = require('path');
const fs = require('fs/promises');
const toml = require('toml');

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
const { VM_DEBUG_EXEC_INFO_FILE } = require('./constants');

let debuggerSession = null;

async function SbpfCompile() {
    const { depsPath } = await gimletConfigManager.resolveGimletConfig();

    if (!await fileExists(depsPath)) {
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

    // TODO: Implement a dispatcher for different build strategies if we decide to add more in the future
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
    const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri; // you said you already have it
    if (!workspaceUri) return;

    const rootPath = workspaceUri.fsPath;
    const hasLitesvm = await hasLitesvmDependency(rootPath);

    if (!hasLitesvm) {
        // Don't activate the extension if litesvm is not found
        return;
    }

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
        
    const sbpfDebugDisposable = vscode.commands.registerCommand('gimlet.debugAtLine', async (document) => {
        // Prevent starting a new session if one is already running
        if (debuggerSession && debuggerSession.debugSessionId) {
            vscode.window.showInformationMessage('A Gimlet debug session is already running. Please stop the current session before starting a new one.');
            return;
        }

        console.log(globalState.globalWorkspaceFolder);
        const hasLitesvm = await hasLitesvmDependency(globalState.globalWorkspaceFolder); 

        if (!hasLitesvm) {
            // Don't activate the extension if litesvm is not found
            vscode.window.showInformationMessage('Litesvm dependency not found in Cargo.toml. Please add litesvm to your dependencies to use Gimlet debugging features.');
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


            const originalEnvPortValue = process.env.VM_DEBUG_PORT;
            const originalEnvOutputValue = process.env.VM_DEBUG_EXEC_INFO_FILE;

            process.env.VM_DEBUG_PORT = debuggerSession.tcpPort.toString();
            process.env.VM_DEBUG_EXEC_INFO_FILE = VM_DEBUG_EXEC_INFO_FILE;

            // remove the lldb.library setting to allow rust-analyzer/typescript test debugger to work properly
            await lldbSettingsManager.disable('library');

            try {
                if (language == 'rust') {
                    const debugListener = vscode.debug.onDidStartDebugSession(session => {
                        // Literally this is the place where the debugging starts
                        // Only the first occurrence of lldb session is relevant(the test session)
                        if (session.type === 'lldb') {
                            debuggerSession.debugSessionId = session.id;
                            debugListener.dispose();
                        }
                    });
                    
                    const result = await startRustAnalyzerDebugSession();
                    
                    if (!result) {
                        vscode.window.showInformationMessage('Please ensure you have selected a runnable in the rust-analyzer prompt.');
                        return;
                    }

                    await lldbSettingsManager.set('library', globalState.lldbLibrary);
                    await startPortDebugListeners();
                } else if (language == 'typescript') {
                    // typescript debug command to run the tests 
                    debugConfigManager.spawnAnchorTestProcess();

                    await lldbSettingsManager.set('library', globalState.lldbLibrary);
                    await startPortDebugListeners();
                }
            } finally {
                // Cleanup strategy for the ENV after command execution
                if (originalEnvPortValue === undefined) {
                    delete process.env.VM_DEBUG_PORT;
                } else {
                    process.env.VM_DEBUG_PORT = originalEnvPortValue;
                }

                if (originalEnvOutputValue === undefined) {
                    delete process.env.VM_DEBUG_EXEC_INFO_FILE;
                } else {
                    process.env.VM_DEBUG_EXEC_INFO_FILE = originalEnvOutputValue;
                }
            }
        } catch (err) {
            console.log(err);
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
}

async function startRustAnalyzerDebugSession() {
    // rust-analyzer command to debug reusing the client and runnables it creates initially
    return await vscode.commands.executeCommand("rust-analyzer.debug");
}


/**
 * Finds all Cargo.toml files recursively, including inside Anchor `programs/*` or `tests/*`
 */
async function findAllCargoToml(dir){
  const results = [];

  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      if (
        entry.name === 'target' ||
        entry.name === 'node_modules' ||
        entry.name.startsWith('.')
      ) {
        continue;
      }

      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name === 'Cargo.toml') {
        results.push(fullPath);
      }
    }
  }

  await walk(dir);
  return results;
}

/**
 * Recursively searches for Cargo.toml files and returns true if any contain `litesvm`
 */
async function hasLitesvmDependency(rootDir) {
  const cargoFiles = await findAllCargoToml(rootDir);

  for (const cargoPath of cargoFiles) {
    try {
      const content = await fs.readFile(cargoPath, 'utf8');
      const parsed = toml.parse(content);

      const deps = parsed.dependencies ?? {};
      const devDeps = parsed['dev-dependencies'] ?? {};

      if (deps['litesvm'] || devDeps['litesvm']) {
        console.log(`Found litesvm in ${cargoPath}`);
        return true;
      }
    } catch (e) {
      console.warn(`Failed to parse ${cargoPath}:`, e);
    }
  }

  return false;
}

async function fileExists(path) {
    try {
        await fs.access(path);
        return true;
    } catch {
        return false;
    }
}


module.exports = {
    activate,
    deactivate,
};


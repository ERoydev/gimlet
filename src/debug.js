const { getDebuggerSession } = require("./managers/sessionManager");
const { workspaceHasLitesvmOrMollusk } = require('./utils');
const { globalState } = require('./state/globalState');

/**
 * Check if a Gimlet debugger session is already active.
 */
function isSessionRunning() {
    const debuggerSession = getDebuggerSession();
    return debuggerSession && debuggerSession.debugSessionId;
}

/**
 * Verifies if workspace contains litesvm or mollusk dependency.
 */
async function hasSupportedBackend() {
    return await workspaceHasLitesvmOrMollusk(globalState.globalWorkspaceFolder);
}

// /**
//  * Main orchestration for Gimlet debug session.
//  */
// async function startGimletDebugSession(document) {
//     debuggerSession = createSessionState();
//     setDebuggerSession(debuggerSession);
//     debuggerSession.tcpPort = globalState.tcpPort;

//     try {
//         await prepareDebugEnvironment();

//         if (document.languageId === 'rust') {
//             await runRustDebugSession();
//         } else if (document.languageId === 'typescript') {
//             await runTypescriptDebugSession();
//         } else {
//             vscode.window.showErrorMessage(`Unsupported language: ${document.languageId}`);
//         }

//     } catch (err) {
//         console.error(err);
//         vscode.window.showErrorMessage(`Failed to debug with Gimlet: ${err.message}`);
//     } finally {
//         await restoreDebugEnvironment();
//     }
// }


// /**
//  * Launches a Rust Analyzer debug session.
//  */
// async function runRustDebugSession() {
//     const debuggerSession = getDebuggerSession();

//     const debugListener = vscode.debug.onDidStartDebugSession(session => {
//         if (session.type === 'lldb' && !debuggerSession.debugSessionId) {
//             // Literally this is the place where the debugging starts
//             // Only the first occurrence of lldb session is relevant(the test session)
//             debuggerSession.debugSessionId = session.id;
//             debugListener.dispose();
//         }
//     });

//     const result = await startRustAnalyzerDebugSession();
//     if (!result) {
//         vscode.window.showInformationMessage('Please ensure you have selected a runnable in the rust-analyzer prompt.');
//         debugListener.dispose();
//         return;
//     }

//     await lldbSettingsManager.set('library', globalState.lldbLibrary);
//     await startPortDebugListeners();
// }

// /**
//  * Utility helper for delay.
//  */
// function delay(ms) {
//     return new Promise(resolve => setTimeout(resolve, ms));
// }

// async function startRustAnalyzerDebugSession() {
//     // rust-analyzer command to debug reusing the client and runnables it creates initially
//     return await vscode.commands.executeCommand("rust-analyzer.debug");
// }

// // UTILS FOR DEBUG
// async function startPortDebugListeners(debuggerSession) {
//     const initialTcpPort = debuggerSession.tcpPort;
//     const CPI_PORT_COUNT = 4; // Solana currently supports up to 4 for CPI

//     const ports = [];
//     for (let i = 0; i < CPI_PORT_COUNT; i++) {
//         ports.push(initialTcpPort + i);
//     }

//     debuggerSession.tcpPort += CPI_PORT_COUNT;
//     portManager.listenAndStartDebugForPorts(ports);
// }

// function cleanupDebuggerSession() {
//     debuggerSession = null;
//     clearDebuggerSession();
// }


module.exports = {
    isSessionRunning,
    hasSupportedBackend
}
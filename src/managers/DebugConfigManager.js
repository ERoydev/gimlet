const path = require('path');
const fs = require('fs');
const toml = require('toml');
const { globalState } = require('../state/globalState');
const { getDebuggerSession } = require('../managers/sessionManager');
const vscode = require('vscode');
const { spawn } = require('child_process');

class DebugConfigManager {

    getTestRunnerFromAnchorToml(workspaceFolder) {
        const anchorTomlPath = path.join(workspaceFolder, 'Anchor.toml');
        if (!fs.existsSync(anchorTomlPath)) return null;
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

    getTypescriptTestLaunchConfig() {
        // TODO: Make sure this works for CPI tests as well
        const workspaceFolder = globalState.globalWorkspaceFolder;
        const runnerInfo = this.getTestRunnerFromAnchorToml(workspaceFolder);
        const debuggerSession = getDebuggerSession();
        if (!debuggerSession) {
            vscode.window.showErrorMessage('No active debugger session found.');
            return null;
        }

        let program;
        if (runnerInfo) {
            program = path.join(workspaceFolder, 'node_modules', runnerInfo.runner, 'bin', runnerInfo.runner);
        } else {
            program = path.join(workspaceFolder, 'node_modules/ts-mocha/bin/ts-mocha');
        }

        return {
            type: "node",
            request: "launch",
            name: "SBPF Debug TypeScript Tests",
            program,
            args: [
                "tests/**/*.ts",
            ],
            cwd: "${workspaceFolder}",
            env: {
                "VM_DEBUG_PORT": debuggerSession.tcpPort.toString(),
                "TS_NODE_TRANSPILE_ONLY": "true",
            },
            console: "internalConsole",
            // console: "integratedTerminal",
            // console: "externalTerminal",
            internalConsoleOptions: "openOnSessionStart",
            runtimeArgs: [
                "--experimental-network-inspection",
            ],
        };
    }

    getLaunchConfigForSolanaLldb(currentTcpPort, programName) {
        const debuggerSession = getDebuggerSession();
        if (!debuggerSession) {
            vscode.window.showErrorMessage('No active debugger session found.');
            return null;
        }
        
        const executablesOfProgram = debuggerSession.executablesPaths[programName];
        const debugExecutablePath = executablesOfProgram ? executablesOfProgram.debugBinary : null;

        if (!debugExecutablePath || !fs.existsSync(debugExecutablePath)) {
            vscode.window.showErrorMessage('Executable path is not set or does not exist. Please first execute `anchor build` then start debugging.');
            return null;
        }

        return {
            type: "lldb",
            request: "launch",
            name: `Sbpf Debug Port: ${currentTcpPort}`,
            targetCreateCommands: [
                `target create ${debugExecutablePath}`,
            ],
            processCreateCommands: [`gdb-remote 127.0.0.1:${currentTcpPort}`],
        };
    }

    // Wait until programName is available or timeout after 10 seconds
    async waitForProgramName(timeoutMs = 10000, intervalMs = 100) {
        const debuggerSession = getDebuggerSession();
        if (!debuggerSession) {
            vscode.window.showErrorMessage('No active debugger session found.');
            return null;
        }

        try {
            const start = Date.now();

            while (Date.now() - start < timeoutMs) {
                const programName = debuggerSession.programHashToProgramName[debuggerSession.currentProgramHash];
                if (programName) return programName;
                await new Promise(resolve => setTimeout(resolve, intervalMs));
            }
            return null;
        } catch (e) {
            vscode.window.showErrorMessage(e.message);
            return null;
        } finally {
            debuggerSession.currentProgramHash = null; // Reset after waiting
        }
    }

    // The test executor for TS anchor tests
    async spawnAnchorTestProcess() {
        return new Promise((resolve, reject) => {
            // Get the active debug console
            const anchorProcess = spawn('anchor', ['test'], {
                env: {
                    ...process.env,
                    VM_DEBUG_PORT: globalState.tcpPort.toString(),
                },
                cwd: globalState.globalWorkspaceFolder,
                stdio: ['inherit', 'pipe', 'pipe']
            });

            anchorProcess.stderr.on('data', (data) => {
                const output = data.toString();
                
                // Extract SHA256 hash from stderr
                const match = output.match(/Debugging executable with \(pre-load\) SHA256: ([a-f0-9]{64})/);
                if (match) {
                    const hash = match[1];
                    // Update the debug session directly
                    const debuggerSession = getDebuggerSession();
                    if (debuggerSession) {
                        debuggerSession.currentProgramHash = hash;
                    }
                }
            });

            anchorProcess.on('error', (error) => {
                console.error(`Failed to start anchor: ${error}`);
                reject(error);
            });

            anchorProcess.on('close', (code) => {
                console.log(`anchor process exited with code ${code}`);
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`anchor process failed with code ${code}`));
                }
            });

            return anchorProcess;
    });
}
}

const debugConfigManager = new DebugConfigManager();

module.exports = { debugConfigManager};
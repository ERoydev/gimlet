const path = require('path');
const fs = require('fs');
const toml = require('toml');
const { globalState } = require('../state/globalState');
const { getDebuggerSession } = require('../managers/sessionManager');
const vscode = require('vscode');
const { spawn } = require('child_process');
const { VM_DEBUG_EXEC_INFO_FILE } = require('../constants');
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
            this.pollForTmpFile(debuggerSession, timeoutMs); 
            const start = Date.now();

            while (Date.now() - start < timeoutMs) {
                // TODO: Handle situations where we have a CPI to a program that is not in this project.
                // It will not be in our map and we need to handle that case.
                const programName = debuggerSession.programHashToProgramName[debuggerSession.currentProgramHash];
                if (programName) {
                    debuggerSession.tmpFilePollToken = null; // Stop polling
                    return programName;
                };
                await new Promise(resolve => setTimeout(resolve, intervalMs));
            }
            return null;
        } catch (e) {
            vscode.window.showErrorMessage(e.message);
            return null;
        } finally {
            debuggerSession.currentProgramHash = null; // Reset after waiting
            debuggerSession.tmpFilePollToken = null; // Stop polling
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
                // TODO: use the output in /tmp/... instead of this
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

    async pollForTmpFile(debuggerSession, timeoutMs = 10000) {
        const filePath = VM_DEBUG_EXEC_INFO_FILE;
        const intervalMs = 1000; // Poll every second
        
        const pollToken = Symbol('tmp-file-poll');
        debuggerSession.tmpFilePollToken = pollToken;
        
        const start = Date.now();
        
        while (debuggerSession.tmpFilePollToken === pollToken && (Date.now() - start < timeoutMs)) {
            try {
                if (fs.existsSync(filePath)) {
                    const content = fs.readFileSync(filePath, 'utf8');
                    vscode.window.showInformationMessage(`Found VM output: ${content}`);
                    
                    // Set the hash so waitForProgramName can use it
                    debuggerSession.currentProgramHash = content.trim();
                    
                    // delete the file after reading
                    fs.unlinkSync(filePath);
                    
                    break; // Stop polling once file is found
                }
            } catch (err) {
                console.error(`Error reading ${VM_DEBUG_EXEC_INFO_FILE} file`, err);
            }
            
            await new Promise(resolve => setTimeout(resolve, intervalMs));
        }
        
        if (Date.now() - start >= timeoutMs) {
            vscode.window.showWarningMessage(`Timeout: ${VM_DEBUG_EXEC_INFO_FILE} not found`);
        }
        
        debuggerSession.tmpFilePollToken = null;
    }
}

const debugConfigManager = new DebugConfigManager();

module.exports = { debugConfigManager};
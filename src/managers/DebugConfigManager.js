const path = require('path');
const fs = require('fs');
const toml = require('toml');
const debuggerSession = require('../state');

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
        const workspaceFolder = debuggerSession.globalWorkspaceFolder;
        const runnerInfo = this.getTestRunnerFromAnchorToml(workspaceFolder);

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
            args: ["tests/**/*.ts"],
            cwd: "${workspaceFolder}",
            env: {
                "VM_DEBUG_PORT": debuggerSession.tcpPort.toString()
            },
            internalConsoleOptions: "openOnSessionStart",
            console: "integratedTerminal"
        };
    }

    getLaunchConfigForSolanaLldb() {
        return {
            type: "lldb",
            request: "launch",
            name: "Sbpf Debug",
            targetCreateCommands: [
                `target create ${debuggerSession.globalExecutablePath}`,
            ],
            processCreateCommands: [`gdb-remote 127.0.0.1:${debuggerSession.tcpPort}`],
        };
    }
}

const debugConfigManager = new DebugConfigManager();

module.exports = { debugConfigManager};
const BaseBuildStrategy = require('./baseBuildStrategy');
const { getDebuggerSession }  = require('../managers/sessionManager');
const vscode = require('vscode');
const fs = require('fs');
const { exec } = require('child_process');
const BuildCommands = require('./buildCommands');

class SbpfV1BuildStrategy extends BaseBuildStrategy {
    constructor(
        workspaceFolder,
        depsPath,
        availablePrograms, 
        buildCommand = BuildCommands.SBF_V1_DEBUG()
    ) {
        super(workspaceFolder, depsPath, availablePrograms);
        this.buildCommand = buildCommand;
        this.debuggerSession = getDebuggerSession();
    }

    static get BUILD_TYPE() {
        return 'V1';
    }

    get buildType() {
        return this.constructor.BUILD_TYPE;
    }

    async build(progress) {
        let files = await this._safeReadDir(this.depsPath);
        if (!files) return;

        const executablesPaths = this.findExecutables(files);
        this.debuggerSession.executablesPaths = executablesPaths;

        for (let packageName of this.availablePrograms) {
            if (!executablesPaths[packageName]) {
                vscode.window.showErrorMessage(
                    `Could not find compiled executable for program: ${packageName} in target/deploy`
                );
                return;
            }

            const { debugBinary, bpfCompiledPath } = executablesPaths[packageName];

            this._deleteIfExists(debugBinary);
            this._deleteIfExists(bpfCompiledPath);
        }

        console.log(`Running build command: ${this.buildCommand}`);
        return new Promise((resolve) => {
            exec(
                // `[ -f Anchor.toml ] && anchor build; rm target/deploy/*.so ; ${this.buildCommand}`,
                this.buildCommand,
                { cwd: this.workspaceFolder },
                async (err, stdout, stderr) => {
                    if (err) {
                        vscode.window.showErrorMessage(
                            `Build error: ${stderr}`
                        );
                        resolve();
                        return;
                    }

                    // After build, set the globalExecutablePath, since its used to load the debug target in launch config
                    // Holds all the compiled programs in target/deploy
                    let newFiles = await this._safeReadDir(this.depsPath);
                    if (!newFiles) {
                        resolve();
                        return;
                    }

                    if (progress)
                        progress.report({
                            increment: 50,
                            message: 'Setting up debugger...',
                        });
                    resolve(true);
                }
            );
        });
    }

    // Helper to delete the target/deploy files if they exist, so i will ensure that we are going to use the SBF V1 compiled SBF files
    _deleteIfExists(filePath) {
        if (filePath && fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    }

    async _safeReadDir(dirPath) {
        try {
            return await fs.promises.readdir(dirPath);
        } catch (err) {
            vscode.window.showErrorMessage(`Error reading directory after V1 build: ${err}`);
            return null;
        }
    }
}

module.exports = {
    SbpfV1BuildStrategy,
};

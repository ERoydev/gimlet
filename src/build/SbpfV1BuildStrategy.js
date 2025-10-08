const BaseBuildStrategy = require('./baseBuildStrategy');
const debuggerSession = require('../state');
const vscode = require('vscode');
const fs = require('fs');
const { exec } = require('child_process');
const BuildCommands = require('./buildCommands');

class SbpfV1BuildStrategy extends BaseBuildStrategy {
    constructor(
        workspaceFolder,
        packageName,
        depsPath,
        buildCommand = BuildCommands.SBF_V1_DEBUG()
    ) {
        super(workspaceFolder, packageName, depsPath);
        this.buildCommand = buildCommand;
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

        const { executablePath, bpfCompiledPath} = this.findDebugExecutable(files);

        this._deleteIfExists(executablePath);
        this._deleteIfExists(bpfCompiledPath);

        console.log(`Running build command: ${this.buildCommand}`);
        return new Promise((resolve) => {
            exec(
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
                    let newFiles = await this._safeReadDir(this.depsPath);
                    if (!newFiles) {
                        resolve();
                        return;
                    }

                    const { executablePath: newExecutablePath } = this.findDebugExecutable(newFiles);

                    if (newExecutablePath && fs.existsSync(newExecutablePath)) {
                        debuggerSession.globalExecutablePath = newExecutablePath;
                    } else {
                        debuggerSession.globalExecutablePath = undefined;
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

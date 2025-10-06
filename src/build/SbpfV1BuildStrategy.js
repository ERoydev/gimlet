const BaseBuildStrategy = require('./baseBuildStrategy');
const debuggerSession = require('../state');
const vscode = require('vscode');
const fs = require('fs');
const { exec } = require('child_process');
const buildCommands = require('./buildCommands');

class SbpfV1BuildStrategy extends BaseBuildStrategy {
    constructor(
        workspaceFolder,
        packageName,
        depsPath,
        buildCommand = buildCommands.SBF_V1_DEBUG_TOOLS151
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
        let files;
        try {
            files = await fs.promises.readdir(this.depsPath);
        } catch (readDirErr) {
            vscode.window.showErrorMessage(
                `Error reading directory: ${readDirErr}`
            );
            return;
        }

        const { executablePath, bpfCompiledPath} = this.findDebugExecutable(files);
        debuggerSession.globalExecutablePath = executablePath;

        this._deleteIfExists(executablePath);
        this._deleteIfExists(bpfCompiledPath);

        return new Promise((resolve) => {
            exec(
                this.buildCommand,
                { cwd: this.workspaceFolder },
                (err, stdout, stderr) => {
                    if (err) {
                        vscode.window.showErrorMessage(
                            `Build error: ${stderr}`
                        );
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
}

module.exports = {
    SbpfV1BuildStrategy,
};

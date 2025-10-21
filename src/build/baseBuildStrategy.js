const crypto = require('crypto');
const fs = require('fs');
const { getDebuggerSession } = require('../managers/sessionManager');

class BaseBuildStrategy {
    constructor(workspaceFolder, depsPath, availablePrograms) {
        this.workspaceFolder = workspaceFolder;
        this.depsPath = depsPath;
        this.availablePrograms = availablePrograms; // List of available programs after build
        this.debuggerSession = getDebuggerSession();
    }

    async build() {
        throw new Error('build() must be implemented by subclasses');
    }

    // Base method that all build strategies are going to use in order to find the executables inside target/deploy 
    findExecutables(files) {
        let executables = {};

        for (let packageName of this.availablePrograms) {
            const debugBinaryFile = this.findExecutableFile(
                files,
                packageName,
                '.debug'
            );

            const soBinaryFile = this.findExecutableFile(
                files,
                packageName,
                '.so'
            );

            const bpfDebugBinaryPath = `${this.depsPath}/${debugBinaryFile}`;
            const bpfSoBinaryPath = `${this.depsPath}/${soBinaryFile}`;
            
            const bpfProgramHash = this._sha256FileSync(bpfSoBinaryPath);

            // The idea is that i create a mapping of programHash to programName, so when can provide the correct executable to the debugger
            this.debuggerSession.setProgramNameForHash(bpfProgramHash, packageName);

            // Map package name to its corresponding debug and .so paths
            executables[packageName] = {
                debugBinary: bpfDebugBinaryPath,
                bpfCompiledPath: bpfSoBinaryPath
            };
        }

        return executables;
    }

    // util for finding the executable file in the target/deploy directory
    findExecutableFile(files, projectName, extension) {
        const transformedProjectName = projectName.replace(/-/g, '_');
        return files.find(
            (file) =>
                file.startsWith(`${transformedProjectName}`) &&
                file.endsWith(extension)
        );
    }

    // Util
    _sha256FileSync(filePath) {
        const data = fs.readFileSync(filePath);
        return crypto.createHash('sha256').update(data).digest('hex');
    }

}

module.exports = BaseBuildStrategy;

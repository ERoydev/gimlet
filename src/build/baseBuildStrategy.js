const crypto = require('crypto');
const fs = require('fs');
const { getDebuggerSession } = require('../managers/sessionManager');

class BaseBuildStrategy {
    constructor(workspaceFolder, depsPath) {
        this.workspaceFolder = workspaceFolder;
        this.depsPath = depsPath;
        this.debuggerSession = getDebuggerSession();
    }

    async build() {
        throw new Error('build() must be implemented by subclasses');
    }

    hashProgram(programFile) {
        const bpfSoBinaryPath = `${this.depsPath}/${programFile}`;
        
        const bpfProgramHash = this._sha256FileSync(bpfSoBinaryPath);
        // const targetRelative = bpfSoBinaryPath.substring(bpfSoBinaryPath.indexOf('target/'));

        // The idea is that i create a mapping of programHash to relativePath to program.so, so when can provide the correct executable to the debugger
        this.debuggerSession.setProgramNameForHash(bpfProgramHash, programFile);
    }

    // Util
    _sha256FileSync(filePath) {
        const data = fs.readFileSync(filePath);
        return crypto.createHash('sha256').update(data).digest('hex');
    }

}

module.exports = BaseBuildStrategy;

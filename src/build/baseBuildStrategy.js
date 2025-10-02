const findExecutableFile = require('../utils/findExecutableFile');
const debuggerSession = require('../state');

class BaseBuildStrategy {
    constructor(workspaceFolder, packageName, depsPath) {
        this.workspaceFolder = workspaceFolder;
        this.packageName = packageName;
        this.depsPath = depsPath;
    }

    static get FUNCTION_ADDRESS_MAP_NAME() {
        return 'function_address_map.txt';
    }

    async build(progress) {
        throw new Error('build() must be implemented by subclasses');
    }

    // Base method that all build strategies are going to use in order to find the executables inside target/deploy 
    findDebugExecutable(files) {
        const executableFile = findExecutableFile(
            files,
            this.packageName,
            '.debug'
        );
        const executablePath = `${this.depsPath}/${executableFile}`;
        console.log(`Executable path: ${executablePath}`);
        console.log(`Executable file: ${executableFile}`);

        const bpfCompiledFile = findExecutableFile(
            files,
            this.packageName,
            '.so'
        );
        const bpfCompiledPath = `${this.depsPath}/${bpfCompiledFile}`;
        debuggerSession.globalBpfCompiledPath = bpfCompiledPath;
        console.log(`BPF compiled path: ${bpfCompiledPath}`);

        return { executablePath, bpfCompiledPath };
    }
}

module.exports = BaseBuildStrategy;

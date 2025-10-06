
class BaseBuildStrategy {
    constructor(workspaceFolder, packageName, depsPath) {
        this.workspaceFolder = workspaceFolder;
        this.packageName = packageName;
        this.depsPath = depsPath;
    }

    async build() {
        throw new Error('build() must be implemented by subclasses');
    }

    // Base method that all build strategies are going to use in order to find the executables inside target/deploy 
    findDebugExecutable(files) {
        const executableFile = this.findExecutableFile(
            files,
            this.packageName,
            '.debug'
        );
        const executablePath = `${this.depsPath}/${executableFile}`;
        console.log(`Executable path: ${executablePath}`);
        console.log(`Executable file: ${executableFile}`);

        const bpfCompiledFile = this.findExecutableFile(
            files,
            this.packageName,
            '.so'
        );
        const bpfCompiledPath = `${this.depsPath}/${bpfCompiledFile}`;

        return { executablePath, bpfCompiledPath };
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
}

module.exports = BaseBuildStrategy;

// util for finding the executable file in the target/deploy directory
function findExecutableFile(files, projectName, extension) {
    const transformedProjectName = projectName.replace(/-/g, '_');
    return files.find(
        (file) =>
            file.startsWith(`${transformedProjectName}`) &&
            file.endsWith(extension)
    );
}

module.exports = findExecutableFile;

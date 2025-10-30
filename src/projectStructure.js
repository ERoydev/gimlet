const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const { globalState } = require('./state/globalState');


// Attempts to find the package name.
async function findSolanaPackageName(workspaceFolder) {

    // 1. Anchor structure (programs/[package-name]/Cargo.toml)
    const programsDir = path.join(workspaceFolder, 'programs');
    const anchorProgramNames = getProgramNames(); // Array of program names

    if (fs.existsSync(programsDir) && anchorProgramNames.length > 0) {
        for (const programName of anchorProgramNames) {
            const anchorCargoPath = path.join(programsDir, programName, 'Cargo.toml');
            const foundPackageName = getPackageNameFromCargo(anchorCargoPath, programName);
            if (!foundPackageName) {
                vscode.window.showErrorMessage(
                    `Cargo.toml not found in program: ${programName}`
                );
                return [];
            }
        }
        return anchorProgramNames;
    }

    // Native structure
    const nativeCargoPath = path.join(workspaceFolder, 'Cargo.toml');
    if (fs.existsSync(nativeCargoPath)) {
        const foundPackageName = getPackageNameFromCargo(nativeCargoPath, workspaceFolder);
        return foundPackageName
    }
    // Not found
}

function getPackageNameFromCargo(cargoPath, dir) {
    if (fs.existsSync(cargoPath)) {
        try {
            const cargoToml = fs.readFileSync(cargoPath, 'utf8');
            const packageNameMatch = cargoToml.match(
                /^\s*name\s*=\s*"([^"]+)"/m
            );
            if (packageNameMatch) {
                return [packageNameMatch[1]]; // Return the package name as an array
            }
        } catch (readError) {
            console.error(
                `Failed to read ${cargoPath}: ${readError.message}`
            );
            vscode.window.showWarningMessage(
                `Error reading program ${dir} Cargo.toml: ${readError.message}`
            );
        }
    }
    return null; // Return null if not found

}

// Returns an array of program names (directory names) in the `programs` directory
function getProgramNames() {
    const programsDir = path.join(globalState.globalWorkspaceFolder, 'programs');
    if (!fs.existsSync(programsDir)) return [];

    return fs.readdirSync(programsDir)
        .filter((entry) => {
            const entryPath = path.join(programsDir, entry);
            return fs.statSync(entryPath).isDirectory();
        });
}


module.exports = { findSolanaPackageName };

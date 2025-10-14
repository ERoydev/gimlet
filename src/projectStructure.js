const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const debuggerSession = require('./state');


// Attempts to find the package name and anchor status for a Solana project.
async function findSolanaPackageName(workspaceFolder) {

    // Check Anchor structure (programs/[package-name]/Cargo.toml)
    const programsDir = path.join(workspaceFolder, 'programs');
    const anchorProgramNames = getAnchorProgramNames(); // Array of program names
    debuggerSession.anchorProjectProgramCount = anchorProgramNames.length; // Set the count of anchor programs

    if (fs.existsSync(programsDir) && anchorProgramNames.length > 0) {
        for (const programName of anchorProgramNames) {
            const anchorCargoPath = path.join(programsDir, programName, 'Cargo.toml');
            const foundPackageName = checkIfAnchorCargoExists(anchorCargoPath, programName);
            if (!foundPackageName) {
                vscode.window.showErrorMessage(
                    `Cargo.toml not found in program: ${programName}`
                );
                return [];
            }
        }
        return anchorProgramNames;
    }
}

function checkIfAnchorCargoExists(anchorCargoPath, dir) {
    if (fs.existsSync(anchorCargoPath)) {
        try {
            const cargoToml = fs.readFileSync(anchorCargoPath, 'utf8');
            const packageNameMatch = cargoToml.match(
                /^\s*name\s*=\s*"([^"]+)"/m
            );
            if (packageNameMatch) {
                return packageNameMatch[1]; // Return the package name instead of setting global variable
            }
        } catch (readError) {
            console.error(
                `Failed to read ${anchorCargoPath}: ${readError.message}`
            );
            vscode.window.showWarningMessage(
                `Error reading program ${dir} Cargo.toml: ${readError.message}`
            );
        }
    }
    return null; // Return null if not found

}

// Returns an array of program names (directory names) in the `programs` directory
function getAnchorProgramNames() {
    const programsDir = path.join(debuggerSession.globalWorkspaceFolder, 'programs');
    if (!fs.existsSync(programsDir)) return [];

    return fs.readdirSync(programsDir)
        .filter((entry) => {
            const entryPath = path.join(programsDir, entry);
            return fs.statSync(entryPath).isDirectory();
        });
}


module.exports = { findSolanaPackageName };

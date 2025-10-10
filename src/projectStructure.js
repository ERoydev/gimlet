const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const debuggerSession = require('./state');

/**
 * Attempts to find the package name and anchor status for a Solana project.
 * @param {string} workspaceFolder
 * @returns {Promise<{packageName: string|null, isAnchor: boolean}>}
 */
async function findSolanaPackageName(workspaceFolder, programName) {
    let packageName = null;

    // Try paths for the three common frameworks
    const potentialPaths = [
        path.join(workspaceFolder, 'program', 'src', 'Cargo.toml'), // Steel & Native
        path.join(workspaceFolder, 'program', 'Cargo.toml'), // Alternative structure
        path.join(workspaceFolder, 'Cargo.toml'), // Root level
    ];

    // Find first available Cargo.toml from common locations
    for (const potentialPath of potentialPaths) {
        if (fs.existsSync(potentialPath)) {
            try {
                const cargoToml = fs.readFileSync(potentialPath, 'utf8');
                const packageNameMatch = cargoToml.match(
                    /^\s*name\s*=\s*"([^"]+)"/m
                );
                if (packageNameMatch) {
                    packageName = packageNameMatch[1];
                    return { packageName, isAnchor: false };
                }
            } catch (error) {
                console.error(
                    `Failed to read or parse ${potentialPath}: ${error.message}`
                );
                vscode.window.showWarningMessage(
                    `Error processing ${path.basename(potentialPath)}: ${error.message}`
                );
                // Continue to next potential path
            }
        }
    }

    // Check Anchor structure (programs/[package-name]/Cargo.toml)
    const programsDir = path.join(workspaceFolder, 'programs');
    if (fs.existsSync(programsDir) && programName) {
        const anchorCargoPath = path.join(programsDir, programName, 'Cargo.toml');
        const foundPackageName = checkIfAnchorCargoExists(anchorCargoPath, programName);
        debuggerSession.selectedAnchorProgramName = programName;
        if (foundPackageName) {
            return { packageName: foundPackageName, isAnchor: true };
        } else {
            vscode.window.showErrorMessage(
                `Cargo.toml not found in program: ${programName}`
            );
            return { packageName: null, isAnchor: false };
        }
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

module.exports = { findSolanaPackageName };

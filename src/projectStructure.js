const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const debuggerSession = require('./state');

/**
 * Attempts to find the package name and anchor status for a Solana project.
 * @param {string} workspaceFolder
 * @returns {Promise<{packageName: string|null, isAnchor: boolean}>}
 */
async function findSolanaPackageName(workspaceFolder) {
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
    const programsList = []; // Contains the names of all programs

    if (fs.existsSync(programsDir)) {
        try {
            const programDirs = fs.readdirSync(programsDir).filter((item) => {
                try {
                    programsList.push(item);
                    return fs
                        .statSync(path.join(programsDir, item))
                        .isDirectory();
                } catch (statError) {
                    console.error(
                        `Failed to check if ${item} is directory: ${statError.message}`
                    );
                    return false;
                }
            });

            // Bellow is the logic to handle multiple programs in an anchor project
            if (programsList.length > 1) {
                const programOptions = programsList.map((item) => ({
                    label: item,
                    description: 'Select a program to debug',
                }));

                const selected = await vscode.window.showQuickPick(
                    programOptions,
                    {
                        placeHolder: 'Select one of your programs to debug',
                    }
                );

                if (!selected) {
                    vscode.window.showErrorMessage(
                        'Gimlet: Please select a program to debug.'
                    );
                    return { packageName: null, isAnchor: false };
                }

                const anchorCargoPath = path.join(
                    programsDir,
                    selected.label,
                    'Cargo.toml'
                );
                const foundPackageName = checkIfAnchorCargoExists(
                    anchorCargoPath,
                    selected.label
                );
                debuggerSession.selectedAnchorProgramName = selected.label;
                if (foundPackageName) {
                    return { packageName: foundPackageName, isAnchor: true };
                } else {
                    vscode.window.showErrorMessage(
                        `Cargo.toml not found in selected program: ${selected.label}`
                    );
                    return { packageName: null, isAnchor: false };
                }
            } else {
                for (const dir of programDirs) {
                    const anchorCargoPath = path.join(
                        programsDir,
                        dir,
                        'Cargo.toml'
                    );
                    const foundPackageName = checkIfAnchorCargoExists(
                        anchorCargoPath,
                        dir
                    );
                    if (foundPackageName) {
                        return {
                            packageName: foundPackageName,
                            isAnchor: true,
                        };
                    } else {
                        vscode.window.showErrorMessage(
                            `Cargo.toml not found in program: ${dir}`
                        );
                        return { packageName: null, isAnchor: false };
                    }
                }
            }
        } catch (error) {
            console.error(
                `Failed to scan programs directory: ${error.message}`
            );
            vscode.window.showWarningMessage(
                `Error scanning program directories: ${error.message}`
            );
        }
    }

    vscode.window.showErrorMessage(
        'Could not find package name in any Cargo.toml'
    );
    return { packageName: null, isAnchor: false };
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

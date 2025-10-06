const vscode = require('vscode');
const os = require('os');
const path = require('path');
const fs = require('fs');

class LldbLibraryManager {
    constructor() {
        this.originalValue = undefined;
        this.config = vscode.workspace.getConfiguration('lldb');
        this.isModified = false;
    }

    /**
     * Temporarily disables (removes) the lldb.library setting
     * so rust-analyzer can take over.
     */
    async disableLibrary() {
        this.originalValue = this.config.get('library');
        await this.config.update('library', undefined, vscode.ConfigurationTarget.Global);

        vscode.window.showInformationMessage('Temporarily disabled LLDB library for rust-analyzer.');
    }

    /**
     * Finds the latest Solana platform liblldb path dynamically.
     */
    findSolanaLldbPath() {
        const homeDir = os.homedir();
        const solanaCacheDir = path.join(homeDir, '.cache', 'solana');

        if (!fs.existsSync(solanaCacheDir)) {
            console.warn('[lldbLibraryManager] Solana cache not found:', solanaCacheDir);
            return undefined;
        }

        // Find folders like v1.51, v1.52, etc.
        const versions = fs.readdirSync(solanaCacheDir)
            .filter(name => /^v\d+\.\d+/.test(name))
            .sort()
            .reverse(); // latest version first

        if (versions.length === 0) {
            vscode.window.showErrorMessage('No Solana versions found in cache.');
            return undefined;
        }

        for (const version of versions) {
            const candidate = path.join(
                solanaCacheDir,
                version,
                'platform-tools',
                'llvm',
                'lib',
                process.platform === 'win32' ? 'liblldb.dll' : 'liblldb.dylib'
            );

            if (fs.existsSync(candidate)) {
                console.log(`[lldbLibraryManager] Found Solana LLDB library: ${candidate}`);
                return candidate;
            }
        }

        console.warn('[lldbLibraryManager] No valid liblldb found in Solana cache.');
        return undefined;
    }

    /**
     * Automatically sets the lldb.library setting to Solana’s liblldb.
     */
    async setLibrary() {
        const customPath = this.findSolanaLldbPath();

        if (!customPath) {
            vscode.window.showWarningMessage(
                'Solana LLDB library not found. Please make sure Solana is installed.'
            );
            return;
        }

        this.originalValue = this.config.get('library');
        await this.config.update('library', customPath, vscode.ConfigurationTarget.Global);
        this.isModified = true;

        vscode.window.showInformationMessage(`LLDB library set to: ${customPath}`);
    }

    /**
     * Restores the LLDB library setting to its original value.
     */
    async restoreLibrary() {
        if (!this.isModified) return;

        await this.config.update('library', this.originalValue, vscode.ConfigurationTarget.Global);
        this.isModified = false;

        vscode.window.showInformationMessage('Restored LLDB library to original value.');
    }
}

const lldbLibraryManager = new LldbLibraryManager();

module.exports = { lldbLibraryManager };

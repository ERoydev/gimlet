const os = require('os');
const path = require('path');
const fs = require('fs');

// Shared state container for the debugger session
const DEFAULT_TCP_PORT = 6612;


// Find the first version directory in ~/.cache/solana
function getPlatformToolsDir() {
    const solanaCacheDir = path.join(os.homedir(), '.cache', 'solana');
    if (!fs.existsSync(solanaCacheDir)) return 'v1.51'; // fallback

    // prefer v1.51 if it exists
    const dirs = fs.readdirSync(solanaCacheDir).filter(name => name.startsWith('v'));
    if (dirs.includes('v1.51')) {
        return 'v1.51';
    }
    // Sort versions descending (latest first)
    const sorted = dirs.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    return sorted.length > 0 ? sorted[0] : 'v1.51';
}

const PLATFORM_TOOLS_VERSION = getPlatformToolsDir();

const libExt = process.platform === 'darwin' ? 'dylib' : 'so';

const DEFAULT_LLDB_LIBRARY_PATH = path.join(
    os.homedir(),
    '.cache',
    'solana',
    PLATFORM_TOOLS_VERSION,
    'platform-tools',
    'llvm',
    'lib',
    `liblldb.${libExt}`
);

class GimletDebuggerSession {
    constructor() {        
        this.globalWorkspaceFolder = null;
        this.buildStrategy = null;
        this.globalExecutablePath = null;
        this.debugSessionId = null;
        this.lldbLibrary = DEFAULT_LLDB_LIBRARY_PATH;
        
        this.tcpPort = DEFAULT_TCP_PORT;
        this.isAnchor = false; // Track if the project is an Anchor project
        this.selectedAnchorProgramName = null; // If it's an Anchor project with multiple programs, this will hold the selected program name(if its null then its single program project)
    }

    reset() {
        this.globalWorkspaceFolder = null;
        this.buildStrategy = null;
        this.globalExecutablePath = null;
        this.debugSessionId = null;
        this.tcpPort = DEFAULT_TCP_PORT;
        this.lldbLibrary = DEFAULT_LLDB_LIBRARY_PATH;
        this.isAnchor = false;
        this.selectedAnchorProgramName = null;
    }
}

// Single Shared Instance
module.exports = new GimletDebuggerSession();

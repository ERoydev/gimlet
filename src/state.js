require('dotenv').config();

const os = require('os');
const path = require('path');

// Shared state container for the debugger session
const DEFAULT_TCP_PORT = process.env.DEFAULT_TCP_PORT || 6612;
const DEFAULT_PLATFORM_TOOLS_VERSION = process.env.DEFAULT_PLATFORM_TOOLS_VERSION || '1.51';
const LIB_EXT = process.platform === 'darwin' ? 'dylib' : 'so';

class GimletDebuggerSession {
    constructor() {        
        this.globalWorkspaceFolder = null;
        this.buildStrategy = null;
        this.globalExecutablePath = null;
        this.debugSessionId = null;
        this.platformToolsVersion = DEFAULT_PLATFORM_TOOLS_VERSION;
        this.lldbLibrary = this.getLldbLibraryPath();
        
        this.tcpPort = DEFAULT_TCP_PORT;
        this.isAnchor = false; // Track if the project is an Anchor project
        this.selectedAnchorProgramName = null; // If it's an Anchor project with multiple programs, this will hold the selected program name(if its null then its single program project)
    }

    
    getLldbLibraryPath() {
        console.log('Platform Tools Version:', this.platformToolsVersion);
        return path.join(
            os.homedir(),
            '.cache',
            'solana',
            `v${this.platformToolsVersion}`,
            'platform-tools',
            'llvm',
            'lib',
            `liblldb.${LIB_EXT}`
        );
    }

    setConfig(config) {
        if (config.tcpPort !== undefined) {
            this.tcpPort = config.tcpPort;
        }
        if (
            config.platformToolsVersion !== undefined &&
            config.platformToolsVersion !== this.platformToolsVersion
        ) {
            this.platformToolsVersion = config.platformToolsVersion;
            this.lldbLibrary = this.getLldbLibraryPath();
        }
    }

    reset() {
        this.globalWorkspaceFolder = null;
        this.buildStrategy = null;
        this.globalExecutablePath = null;
        this.debugSessionId = null;
        this.tcpPort = DEFAULT_TCP_PORT;
        this.platformToolsVersion = DEFAULT_PLATFORM_TOOLS_VERSION;
        this.lldbLibrary = this.getLldbLibraryPath();
        this.isAnchor = false;
        this.selectedAnchorProgramName = null;
    }
}

// Single Shared Instance
module.exports = new GimletDebuggerSession();

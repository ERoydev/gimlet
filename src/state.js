require('dotenv').config();

const os = require('os');
const path = require('path');
const fs = require('fs');

// Shared state container for the debugger session
const DEFAULT_TCP_PORT = process.env.DEFAULT_TCP_PORT || 6612;
const DEFAULT_PLATFORM_TOOLS_VERSION = process.env.DEFAULT_PLATFORM_TOOLS_VERSION || '1.51';
const LIB_EXT = process.platform === 'darwin' ? 'dylib' : 'so';

class GimletDebuggerSession {
    constructor() {        
        this.globalWorkspaceFolder = null;
        this.buildStrategy = null;
        this.executablesPaths = {}; // Map of programName to executablePath
        this.programHashToProgramName = []; 
        this.debugSessionId = null;
        this.platformToolsVersion = DEFAULT_PLATFORM_TOOLS_VERSION;
        this.lldbLibrary = this.getLldbLibraryPath();
        this.anchorProjectProgramCount = 0;
        this.currentProgramHash = null;
        
        this.tcpPort = DEFAULT_TCP_PORT;
    }
    
    getLldbLibraryPath() {
        const libPath = path.join(
            os.homedir(),
            '.cache',
            'solana',
            `v${this.platformToolsVersion}`,
            'platform-tools',
            'llvm',
            'lib',
            `liblldb.${LIB_EXT}`
        );
        // This will resolve symlinks if present, or just return the absolute path if not
        return fs.realpathSync(libPath);
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

    incrementTcpPort() {
        this.tcpPort += 1;
    }

    setProgramNameForHash(programHash, programName) {
        this.programHashToProgramName[programHash] = programName;
    }

    reset() {
        this.globalWorkspaceFolder = null;
        this.buildStrategy = null;
        this.executablesPaths = {};
        this.programHashToProgramName = [];
        this.debugSessionId = null;
        this.platformToolsVersion = DEFAULT_PLATFORM_TOOLS_VERSION;
        this.lldbLibrary = this.getLldbLibraryPath();
        this.anchorProjectProgramCount = 0;
        this.currentProgramHash = null;
        this.tcpPort = DEFAULT_TCP_PORT;
    }
}

// Single Shared Instance
module.exports = new GimletDebuggerSession();

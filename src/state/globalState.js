require('dotenv').config();

const os = require('os');
const path = require('path');
const fs = require('fs');

// Shared state container for the debugger session
const DEFAULT_TCP_PORT = process.env.DEFAULT_TCP_PORT || 6612;
const DEFAULT_PLATFORM_TOOLS_VERSION = process.env.DEFAULT_PLATFORM_TOOLS_VERSION || '1.51';
const LIB_EXT = process.platform === 'darwin' ? 'dylib' : 'so';

// General (global) state, singleton
class GimletGeneralState {
    constructor() {
        this.globalWorkspaceFolder = null;
        this.platformToolsVersion = DEFAULT_PLATFORM_TOOLS_VERSION;
        this.lldbLibrary = this.getLldbLibraryPath();
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
        return fs.realpathSync(libPath);
    }

    setPlatformToolsVersion(version) {
        if (version && version !== this.platformToolsVersion) {
            this.platformToolsVersion = version;
            this.lldbLibrary = this.getLldbLibraryPath();
        }
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
}

module.exports = {
    globalState: new GimletGeneralState(), // Singleton
}

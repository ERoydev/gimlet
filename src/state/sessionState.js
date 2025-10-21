
class GimletDebuggerSession {
    constructor() {        
        this.debugSessionId = null;
        this.buildStrategy = null;

        this.executablesPaths = {}; // Map of programName to executablePath
        this.programHashToProgramName = []; 
        this.currentProgramHash = null;
        
        this.tcpPort = null;
    }

    setProgramNameForHash(programHash, programName) {
        this.programHashToProgramName[programHash] = programName;
    }

    reset() {
        this.debugSessionId = null;
        this.buildStrategy = null;
        this.executablesPaths = {};
        this.programHashToProgramName = [];
        this.currentProgramHash = null;
        this.tcpPort = null;
    }
}

// Factory function to create a new session
function createSessionState() {
    return new GimletDebuggerSession();
}

module.exports = {
    createSessionState,
};
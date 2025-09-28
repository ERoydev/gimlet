// Shared state container for the debugger session
const INITIAL_BP_COUNTER = 1;

class GimletDebuggerSession {
    constructor() {
        this.bpCounter = INITIAL_BP_COUNTER;
        this.breakpointListenerDisposable = null;
        this.activeTerminal = null;
        this.breakpointMap = new Map();
        
        this.globalWorkspaceFolder = null;
        this.globalBpfCompiledPath = null;
        this.globalInputPath = null;
        this.functionAddressMapPath = null;
        
        this.tcpPort = 5522;
        this.host = '127.0.0.1';
        this.isLldbConnected = false; // Track if LLDB is connected to the gdb server
        this.isAnchor = false; // Track if the project is an Anchor project
        this.selectedAnchorProgramName = null; // If it's an Anchor project with multiple programs, this will hold the selected program name(if its null then its single program project)
    }

    reset() {
        this.bpCounter = INITIAL_BP_COUNTER;
        if (this.breakpointListenerDisposable) {
            this.breakpointListenerDisposable.dispose();
            this.breakpointListenerDisposable = null;
            this.breakpointMap.clear();
        }
        this.activeTerminal = null;
        this.isLldbConnected = false;
        this.isAnchor = false;
        this.selectedAnchorProgramName = null;
    }
}

// Single Shared Instance
module.exports = new GimletDebuggerSession();

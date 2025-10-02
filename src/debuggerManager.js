const vscode = require('vscode');
const debuggerSession = require('./state');
const getFunctionNameAtLine = require('./utils/getFunctionNameAtLine');
const getAddressFromFunctionName = require('./utils/getAddressFromFunctionName');
const path = require('path');

class LldbDebuggerManager {
    constructor() {
        this.terminal = null;
        // Default to function name + address strategy
        this.deriveBreakpoint = this.defaultDeriveBreakpoint;
    }

    getTerminal() {
        return this.terminal;
    }

    setTerminal(terminal) {
        this.terminal = terminal;
        debuggerSession.activeTerminal = terminal;
    }

    // Allow changing breakpoint derivation strategy
    setBreakpointStrategy(strategyFn) {
        this.deriveBreakpoint = strategyFn;
    }

    // Default strategy using function name + address from llvm-objdump
    defaultDeriveBreakpoint(bp) {
        const line = bp.location.range.start.line + 1;
        const functionName = getFunctionNameAtLine(
            bp.location.uri.fsPath,
            line
        );
        if (!functionName) {
            throw new Error(`Could not find function name at line ${line}`);
        }

        const BpAddress = getAddressFromFunctionName(functionName);
        if (!BpAddress) {
            throw new Error(
                `Could not resolve address for function ${functionName}`
            );
        }

        return !debuggerSession.isAnchor
            ? `breakpoint set --name ${BpAddress}`
            : `breakpoint set --address ${BpAddress}`;
    }

    // Simple strategy using file + line
    static lineNumberStrategy(bp) {
        const line = bp.location.range.start.line + 1;
        const file = bp.location.uri.fsPath; // Should be absolute path
        return `breakpoint set --file ${file} --line ${line}`;
    }

    restoreBreakpoints() {
        const allBreakpoints = vscode.debug.breakpoints;
        if (!allBreakpoints || allBreakpoints.length === 0 || !this.terminal)
            return;

        allBreakpoints.forEach((bp) => {
            if (bp.location) {
                try {
                    const command = this.deriveBreakpoint(bp);
                    this.terminal.sendText(command);
                    debuggerSession.breakpointMap.set(
                        bp.id,
                        debuggerSession.bpCounter++
                    );
                } catch (error) {
                    vscode.window.showWarningMessage(
                        `Skipping breakpoint: ${error.message}`
                    );
                }
            }
        });
    }

    listenForBreakpointChanges() {
        return vscode.debug.onDidChangeBreakpoints((event) => {
            if (!this.terminal || !debuggerSession.activeTerminal) return;

            this.handleAddedBreakpoints(event.added);
            this.handleRemovedBreakpoints(event.removed);
        });
    }

    handleAddedBreakpoints(breakpoints) {
        breakpoints.forEach((bp) => {
            if (!bp.location || this.isTestBreakpoint(bp)) return;

            try {
                const command = this.deriveBreakpoint(bp);
                this.terminal.sendText(command);
                debuggerSession.breakpointMap.set(
                    bp.id,
                    debuggerSession.bpCounter++
                );
            } catch (error) {
                vscode.window.showWarningMessage(
                    `Skipping breakpoint: ${error.message}`
                );
            }
        });
    }

    handleRemovedBreakpoints(breakpoints) {
        breakpoints.forEach((bp) => {
            if (!bp.location || this.isTestBreakpoint(bp)) return;
            
            const breakpoint = debuggerSession.breakpointMap.get(bp.id);
            if (breakpoint) {
                this.terminal.sendText(`breakpoint delete ${breakpoint}`);
                debuggerSession.breakpointMap.delete(bp.id);
            }
        });
    }

    selectBreakpoint(callback, breakpointList = null, includeFileName = false) {
        // The callback is a function that will be called with (breakpoint, functionName)
        // So when the user selects the breakpoint, callback is going to be the function starting some operation for the debugging
        // breakpointList: optional array of breakpoints to choose from, if null then use all breakpoints in the workspace
        // includeFileName: if true, passes fileName as third parameter to callback

        const allBreakpoints = breakpointList || vscode.debug.breakpoints;
        let bpObject = null;

        if (!allBreakpoints || allBreakpoints.length === 0) {
            vscode.window.showErrorMessage(
                'No breakpoints found. Please set a breakpoint first.'
            );
            return;
        }
        
        // if one breakpoint, just run it instantly
        if (allBreakpoints.length === 1) {
            const bp = allBreakpoints[0];
            if (bp.location) {
                const line = bp.location.range.start.line + 1;
                const fileName = path.basename(bp.location.uri.fsPath);
                const functionName = getFunctionNameAtLine(
                    bp.location.uri.fsPath,
                    line
                );
                bpObject = bp;

                if (functionName) {
                    if (includeFileName) {
                        callback(bpObject, functionName, fileName);
                    } else {
                        callback(bpObject, functionName);
                    }
                } else {
                    vscode.window.showErrorMessage(
                        'Breakpoint is not inside a function.'
                    );
                }
            }
            return;
        }

        // if more than one breakpoints, let user select one
        const breakpointOptions = allBreakpoints
            .filter((bp) => bp.location)
            .map((bp, index) => {
                const line = bp.location.range.start.line + 1;
                const fileName = path.basename(bp.location.uri.fsPath);
                const functionName = getFunctionNameAtLine(
                    bp.location.uri.fsPath,
                    line
                );

                return {
                    label: `${fileName}:${line}`,
                    description: functionName
                        ? `Function: ${functionName}`
                        : 'Not in a function',
                    breakpoint: bp,
                    functionName: functionName,
                    fileName: fileName,
                };
            });

        vscode.window
            .showQuickPick(breakpointOptions, {
                placeHolder: 'Select a breakpoint to run agave-ledger-tool for',
            })
            .then((selected) => {
                if (selected && selected.functionName) {
                    bpObject = selected.breakpoint;
                    if (includeFileName) {
                        callback(bpObject, selected.functionName, selected.fileName);
                    } else {
                        callback(bpObject, selected.functionName);
                    }
                } else if (selected) {
                    vscode.window.showErrorMessage(
                        'Selected breakpoint is not inside a function.'
                    );
                }
            });
    }

    // TODO: improve test file detection for SolanaLLDB breakpoints
    isTestBreakpoint(bp) {
        if (!bp.location) return false;
        const filePath = bp.location.uri.fsPath;
        return (
            filePath.includes('/tests/') ||
            filePath.includes('\\tests\\') ||
            filePath.includes('.test.') ||
            filePath.endsWith('.spec.js') ||
            filePath.endsWith('.test.js')
        );
    }
}

// Single instance
const debuggerManager = new LldbDebuggerManager();

// Export both the instance and the class
module.exports = {
    debuggerManager,
    LldbDebuggerManager,
};

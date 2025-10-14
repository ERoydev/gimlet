const vscode = require('vscode');

const LENS_TITLE= "Sbpf Debug";

// Custom CodeLens provider that shows "Gimlet Debug" button above Rust test functions
class GimletCodeLensProvider {
    // Vs code calls this method automatically 
    // whenever it needs to show or update CodeLens annotations in the editor for supported files.
    provideCodeLenses(document) {
    const lenses = [];
    const isRust = document.languageId === 'rust';
    const isTypeScript = document.languageId === 'typescript';

    if (isRust) {
        return vscode.commands.executeCommand(
            'vscode.executeDocumentSymbolProvider',
            document.uri
        ).then(symbols => {
            if (!symbols) return lenses;

            // Recursively process symbols to find test functions
            const processSymbols = (symbols) => {
                for (const symbol of symbols) {
                    if (symbol.kind === vscode.SymbolKind.Function) {
                        const functionName = symbol.name;
                        const line = symbol.range.start.line;

                        if (this.isTestFunction(document, line, functionName)) {
                            lenses.push(
                                new vscode.CodeLens(symbol.range, {
                                    title: `$(debug-alt) ${LENS_TITLE}`,
                                    command: "gimlet.debugAtLine",
                                    arguments: [document, functionName],
                                })
                            );
                        }
                    }
                    if (symbol.children && symbol.children.length > 0) {
                        processSymbols(symbol.children);
                    }
                }
            };
            processSymbols(symbols);
            return lenses;
        });
        
    } else if (isTypeScript) {
        return vscode.commands.executeCommand(
            'vscode.executeDocumentSymbolProvider',
            document.uri
        ).then(symbols => {
            if (!symbols) return lenses;
            // Recursively process symbols to find describe/it/test blocks
            const processSymbols = (symbols) => {
                for (const symbol of symbols) {
                    if (symbol.name && /^(it|test)\b/i.test(symbol.name)) {
                        const range = symbol.range;
                        const functionName = this.extractTestNameFromSymbolName(symbol.name);

                        lenses.push(
                            new vscode.CodeLens(range, {
                                title: `$(debug-alt) ${LENS_TITLE}`,
                                command: "gimlet.debugAtLine",
                                arguments: [document, functionName],
                            })
                        );
                    }
                    if (symbol.children && symbol.children.length > 0) {
                        processSymbols(symbol.children);
                    }
                }
            };
            processSymbols(symbols);
            return lenses;
        });
    }

    return lenses;
}

    /**
     * Determines if a function is a test function by checking for test attributes
     * or test naming conventions
     */
    isTestFunction(document, lineIndex, functionName) {
        // Check for test attributes above the function
        if (this.hasTestAttribute(document, lineIndex)) {
            return true;
        }

        // Check if function name suggests it's a test
        const testNamePatterns = [
            /^test_/,
            /_test$/,
            /^it_/,
            /^should_/
        ];

        return testNamePatterns.some(pattern => pattern.test(functionName));
    }

    /**
     * Checks for test-related attributes above a function
     */
    hasTestAttribute(document, lineIndex) {
        for (let i = lineIndex - 1; i >= 0; i--) {
            const line = document.lineAt(i);
            const trimmed = line.text.trim();

            // Check for various test attributes
            const testAttributes = [
                /#\[test\]/,
                /#\[tokio::test\]/,
                /#\[async_test\]/,
                /#\[test\(.*\)\]/,  // parameterized tests
                /#\[cfg\(test\)\]/
            ];

            if (testAttributes.some(attr => attr.test(trimmed))) {
                return true;
            }

            // Skip empty lines, comments, and other attributes
            if (trimmed === "" || trimmed.startsWith("//") || trimmed.startsWith("#[")) {
                continue;
            }

            // Hit non-attribute code, stop searching
            break;
        }

        return false;
    }

    getAnchorProgramName(document) {
    // Example: /workspace/programs/program-a/src/lib.rs
        const filePath = document.uri.fsPath;
        const match = filePath.match(/programs[\/\\]([^\/\\]+)/);
        return match ? match[1] : null;
    }

    extractTestNameFromSymbolName(symbolName) {
        // Matches it("name"), test('name'), describe(`name`)
        const match = symbolName.match(/^(?:it|test|describe)\s*\(\s*['"`](.+?)['"`]\s*\)/);
        return match ? match[1] : symbolName;
    }
}

module.exports = {
    GimletCodeLensProvider
}
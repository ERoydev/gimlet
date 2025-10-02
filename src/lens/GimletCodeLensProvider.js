const vscode = require('vscode');

const LENS_TITLE= "Sbpf Debug";

// Custom CodeLens provider that shows "Gimlet Debug" button above Rust test functions
class GimletCodeLensProvider {
    provideCodeLenses(document, token) {
        const lenses = [];

        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i);

            // More robust function detection using regex
            const fnMatch = line.text.match(/^\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/);
            if (fnMatch && !line.text.includes("//")) {
                const functionName = fnMatch[1];

                if (this.isTestFunction(document, i, functionName)) {
                    const range = new vscode.Range(i, 0, i, 0);
                    lenses.push(
                        new vscode.CodeLens(range, {
                            title: `$(debug-alt) ${LENS_TITLE}`,
                            command: "gimlet.debugAtLine",
                            arguments: [document, i],
                        })
                    );
                }
            }
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
}

module.exports = {
    GimletCodeLensProvider
}
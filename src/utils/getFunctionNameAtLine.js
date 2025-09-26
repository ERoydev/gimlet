const fs = require('fs');

// This func is used to get the function name from a specific line in a file
// It reads the lib.rs file, tracks the function definitions, and returns the function name at the specified line number
function getFunctionNameAtLine(filePath, lineNumber) {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    let depth = 0;
    let name = null;

    for (let i = 0; i < lines.length; i++) {
        if (/fn\s+(\w+)/.test(lines[i])) {
            name = RegExp.$1;
            depth = 0;
        }

        depth += (lines[i].match(/{/g) || []).length;
        depth -= (lines[i].match(/}/g) || []).length;

        if (i + 1 === lineNumber) return depth > 0 ? name : null;
    }

    return null;
}

module.exports = getFunctionNameAtLine;

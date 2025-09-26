const debuggerSession = require('../state');
const fs = require('fs');
const path = require('path');

function getAddressFromFunctionName(functionName) {
    // const mapFilePath = path.join(globalWorkspaceFolder, functionAddressMapName);
    const mapFilePath = debuggerSession.functionAddressMapPath;
    if (!mapFilePath || !fs.existsSync(mapFilePath)) {
        return null;
    }
    const lines = fs.readFileSync(mapFilePath, 'utf8').split('\n');
    for (const line of lines) {
        if (debuggerSession.isAnchor) {
            // `global::` is Anchor's internal naming convention for an instruction discriminator
            if (line.match(new RegExp(`global::${functionName}(::|$)`))) {
                return line.split(' ')[0]; // Return the address part of the line
            }
        } else {
            /**
             * Note: This is for native Solana programs.
             * If the user uses the `#[no_mangle]` attribute, the function name will be preserved as is.
             * If the user uses the `#[inline(never)]` attribute, they will be able to debug the function.
             * (This is necessary if the function is too simple and Rust optimizes logic at compile time.)
             */
            // TODO: Find a way to handle this without making the user to use `#[no_mangle]` and `#[inline(never)]` macros
            if (line.match(new RegExp(`${functionName}`))) {
                /**
                 * Note: If we use the raw address instead of the function name, Solana sometimes remaps
                 * this address in LLDB to another (invalid) address. This can cause breakpoints to be set
                 * incorrectly or not trigger as expected. Using the function name is more reliable for
                 * setting breakpoints in this context.
                 */
                return functionName;
            }
        }
    }
    return null;
}

module.exports = getAddressFromFunctionName;

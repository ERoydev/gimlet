const vscode = require('vscode');
const net = require('net');

/**
 * Checks if a TCP port is open (something is listening).
 */
function isPortOpen(port, host = '127.0.0.1') {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(1000);
        socket.once('connect', () => {
            socket.destroy();
            resolve(true);
        });
        socket.once('timeout', () => {
            socket.destroy();
            resolve(false);
        });
        socket.once('error', () => {
            resolve(false);
        });
        socket.connect(port, host);
    });
}

/**
 * Polls the port every 2 seconds and shows a message when a client connects.
 */
async function pollDebuggerConnection(port, host = '127.0.0.1') {
    let wasOpen = false;
    while (true) {
        console.log('INSIDEEE');
        const open = await isPortOpen(port, host);
        if (open && !wasOpen) {
            console.log(`Debugger connected to ${host}:${port}`);
            wasOpen = true;
        } else if (!open && wasOpen) {
            console.log(`Debugger disconnected from ${host}:${port}`);
            wasOpen = false;
        }
        await new Promise((res) => setTimeout(res, 2000));
    }
}

module.exports = pollDebuggerConnection;

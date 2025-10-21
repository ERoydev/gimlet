
```sh
breakpoint set --file /Users/emilemilovroydev/Rust/projects/Solana/gimlet-raw/gimlet/examples/anchor-multi-program/programs/program-a/src/lib.rs --line 35
breakpoint set --file /Users/emilemilovroydev/Rust/projects/Solana/gimlet-raw/gimlet/examples/anchor-multi-program/programs/program-b/src/lib.rs --line 15
```


# Using gdbstub monitor we add custom command `program_hash`

```lldb
process plugin packet monitor program_hash
```


program_a.so
`8ff346e2ba62514a2bedf8ed00dcf4b80573e8f301fc4e4e364b3cfeb85b72ce`

program_b.so
`cde537b93327d4526df84af6fc8bad9da62651bff16f3eccc791fb3c9178bfbd`


target module add /Users/emilemilovroydev/Rust/projects/Solana/gimlet-raw/gimlet/examples/anchor-multi-program/target/deploy/program_a.debug 
target symbols add /Users/emilemilovroydev/Rust/projects/Solana/gimlet-raw/gimlet/examples/anchor-multi-program/target/deploy/program_a.debug 

target module add /Users/emilemilovroydev/Rust/projects/Solana/gimlet-raw/gimlet/examples/anchor-multi-program/target/deploy/program_a.so
target symbols add /Users/emilemilovroydev/Rust/projects/Solana/gimlet-raw/gimlet/examples/anchor-multi-program/target/deploy/program_a.so

# full path of debug
/Users/emilemilovroydev/Rust/projects/Solana/gimlet-raw/gimlet/examples/anchor-multi-program/target/deploy/program_a.debug 


# Output streams problem

Node JS streams (process.stdout / process.stderr) are JS-level wrappers inside the Node process. Anything written via console.log() or console.error() goes through these streams. So they are wrappers around the OS file descriptors (fd)

Rust eprintln!() (via napi) writes directly to the OS-level file descriptor (fd 2 for stderr), completely bypassing Node’s JS streams.

That’s why Debug Console (which only watches Node JS streams) never sees eprintln!().
In contrast, a terminal shows it because fd 2 is attached to the terminal device.

- Node streams and OS-level stderr are separate; napi native writes go straight to the OS, not into the Node JS streams.

```sh
What’s actually happening:

1. Node JS streams (process.stdout / process.stderr)
- These are JS-level wrappers around the OS file descriptors:
    stdout → fd 
    stderr → fd 2
- console.log() and console.error() write through these wrappers.
- Node can override the JS stream (like your process.stdout.write patch) and VS Code can hook them for internalConsole.

2. Rust eprintln!() via napi
- N-API calls in Rust write directly to the OS file descriptor (fd 2).
- Node’s JS stream layer is not involved at all — Node doesn’t see these writes as JS-level output.
-T his is why internalConsole (which only monitors Node JS streams) doesn’t capture it.

3. dup2(STDOUT, STDERR) trick
- This redirects OS fd 2 → fd 1.
- Rust’s eprintln!() now goes to fd 1 (stdout).
- Node JS stream for stdout still sees native writes only if Node flushes the fd through its JS stream, which it doesn’t automatically.
- So internalConsole still doesn’t see Rust output unless you explicitly funnel it through Node.

dup2 moves Rust output from fd 2 → fd 1, but does not make it part of Node’s JS stream.
Node’s internalConsole only sees what flows through JS streams, not raw OS fds.

Rust writes directly to the OS-level file descriptor, bypassing Node.js's JS-level stream overrides.
This is a limitation of Node.js and how native modules interact with stdio.
```

Assumption
```sh
eprintln writes to OS fd; Node internalConsole only reads Node JS streams.
They are in the same process but use different “channels”.
```

# Reproducing Rust `eprint!()` capture via `dtruss` on macOS

## Steps

1. **Run your test normally via `ts-mocha`:**

```bash
npx ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts
```

2. **Find the Node PID** that runs Mocha:

```bash
ps aux | grep mocha
```

Look for the Node process that actually runs your tests (not the parent `yarn` or `ts-mocha` wrapper).  
Example: PID 8934.

3. **Attach `dtruss` to that PID** to intercept all writes to stderr:

```bash
sudo dtruss -p 8934 -t write 2>&1 | grep 'write(0x2'
```

- `-p 8934` → attach to the Node PID.
- `-t write` → trace `write()` syscalls.
- `write(0x2` → filter only stderr (fd 2) writes.

4. **Trigger Rust `eprint!()`** in your test.

You should see output like:

```
write(0x2, "Error: something from Rust\n", 28)
```

5. **Optional:** Add a short delay in your test if it finishes too fast to attach:

```ts
await new Promise(r => setTimeout(r, 5000));
```

---

- Problem: I need to attach to this PID before it executes so i can capture the initial program_hash.

✅ Result: You can capture Rust’s native stderr output in real time, fully at the OS level, without changing Node or VS Code.

# That proves this

1. Rust eprint!() writes to OS fd 2 (stderr).
2. Node-level stream overrides do not capture it — because Rust bypasses Node entirely.
3. VS Code Debug Console doesn’t see it — only the integrated terminal or OS-level tools do.
4. Attaching `dtruss` to the Node PID running the test allows you to observe every write to fd 2 in real time, including your Rust output.

# TODO:

```
"rust-analyzer.debug.engineSettings": {
    "lldb": {
        "terminal": "external"
    }    
},
"rust-analyzer.runnables.extraTestBinaryArgs": [
    "--show-output",
    "--nocapture"
],
```
- This should be added with the settings so test's can capture output from Debug Console
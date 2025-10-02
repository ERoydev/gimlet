
/**
 * Solana BPF build commands with debug symbols enabled for debugging support.
 * Each command targets different BPF architectures and platform tool versions.
*/
const BuildCommands = Object.freeze({
    // Legacy SBF v0 build command
    // Uses default platform tools and produces debug-enabled bytecode (still optimized)
    SBF_V0_DEBUG: 'cargo build-sbf --debug',

    // SBF V1 build with specific platform tools `v1.51`
    // - arch v1: Targets the newer BPF virtual machine architecture
    // This is a build without optimizations, applying the dynamic stack frames
    SBF_V1_DEBUG_TOOLS151:
        'cargo-build-sbf --tools-version v1.51 --debug --arch v1',

    // future platform tools / SBF versions can be added here
});

module.exports = BuildCommands;

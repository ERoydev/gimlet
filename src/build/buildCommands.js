const BuildCommands = Object.freeze({
    SBF_V0_DEBUG: 'cargo build-sbf --debug',

    // SBF v1 with platform tools v1.51
    SBF_V1_DEBUG_TOOLS151:
        'cargo-build-sbf --tools-version v1.51 --debug --arch v1',

    // future platform tools / SBF versions can be added here
});

module.exports = BuildCommands;

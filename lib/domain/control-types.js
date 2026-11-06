// Allowed forward transitions. Any other jump is a programming error.
export const PHASE_TRANSITIONS = {
    pending: ['filtered', 'failed'],
    filtered: ['decided', 'failed'],
    // decided -> verified covers a decision that no reply is needed.
    decided: ['acting', 'verified', 'failed'],
    // acting -> verified covers dry-run, where nothing is actually transmitted.
    acting: ['sent', 'verified', 'failed'],
    sent: ['verified', 'failed'],
    verified: [],
    failed: ['pending'],
};

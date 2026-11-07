export type OwnerCommand = {
    kind: 'status';
} | {
    kind: 'feed';
    count: number;
} | {
    kind: 'unknown';
    raw: string;
};
/**
 * Parses an owner command from an inbound message.
 *
 * The passphrase is a second factor on top of the owner-account list: without
 * it, an attacker holding the account can only chat, not command. It is
 * deliberately not a permission escalator — the command set stays small and
 * every side-effecting command is still checked by the outbound policy.
 */
export declare function parseOwnerCommand(text: string, passphrase: string): OwnerCommand | null;

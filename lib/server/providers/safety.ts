export const MAINNET_MUTATIONS_ENABLED = false as const;

export class MainnetMutationLockedError extends Error {
  readonly code = "MAINNET_MUTATION_LOCKED";

  constructor() {
    super("Mainnet mutations are disabled for this prototype.");
    this.name = "MainnetMutationLockedError";
  }
}

/**
 * Every future route or worker that can sign or submit a transaction must call
 * this guard before it touches a wallet, swap builder, RPC send method, or job.
 */
export function assertMainnetMutationEnabled(): never {
  throw new MainnetMutationLockedError();
}

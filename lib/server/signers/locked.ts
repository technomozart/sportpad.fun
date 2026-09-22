import "server-only";

import type { ManagedSignerProvider } from "./types";

export class LockedSignerProvider implements ManagedSignerProvider {
  readonly provider = "locked";

  async getAddress(): Promise<string> {
    throw new Error("Managed signer is not configured.");
  }

  async signAndSend(): Promise<never> {
    throw new Error("Transaction signing is locked.");
  }
}

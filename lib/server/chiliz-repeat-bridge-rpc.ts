/** Require independent HTTPS Chiliz RPC origins for finality cross-checks. */
export function independentChilizRpcOrigins(primary: string,
  secondary: string): boolean {
  try {
    const a = new URL(primary);
    const b = new URL(secondary);
    return a.protocol === "https:" && b.protocol === "https:" &&
      Boolean(a.hostname) && Boolean(b.hostname) &&
      !a.username && !a.password && !a.hash &&
      !b.username && !b.password && !b.hash &&
      a.origin.toLowerCase() !== b.origin.toLowerCase();
  } catch { return false; }
}

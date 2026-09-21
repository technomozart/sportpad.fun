"use client";

import { Check, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";

export function TokenAddressCell({ mint, symbol }: { mint: string; symbol: string }) {
  const [copied, setCopied] = useState(false);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(mint);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <span className="registry-address-cell">
      <code title={mint}>{mint.slice(0, 8)}...{mint.slice(-7)}</code>
      <button type="button" onClick={copyAddress} aria-label={`Copy ${symbol} Solana token address`} title="Copy address">
        {copied ? <Check /> : <Copy />}
      </button>
      <a href={`https://explorer.solana.com/address/${encodeURIComponent(mint)}`} target="_blank" rel="noopener noreferrer" aria-label={`Open ${symbol} in Solana Explorer`} title="Open in Solana Explorer">
        <ExternalLink />
      </a>
      <span className="sr-only" aria-live="polite">{copied ? `${symbol} address copied` : ""}</span>
    </span>
  );
}

"use client";

import { ShieldCheck, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type SolanaWalletChoice = {
  id: string;
  name: string;
};

export function SolanaWalletSelector({
  open,
  wallets,
  busy,
  onCancel,
  onSelect,
}: {
  open: boolean;
  wallets: SolanaWalletChoice[];
  busy: boolean;
  onCancel: () => void;
  onSelect: (walletId: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen && !busy) onCancel();
    }}>
      <DialogContent className="z-[70] border-white/10 bg-[#0b100d] text-white sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Choose your Solana wallet</DialogTitle>
          <DialogDescription className="leading-relaxed text-white/50">
            More than one compatible wallet is installed. Choose the wallet that should sign the SportPad ownership challenge.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2" role="list" aria-label="Detected Solana wallets">
          {wallets.map((wallet) => (
            <Button
              key={wallet.id}
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => onSelect(wallet.id)}
              className="h-auto min-h-14 justify-start border-white/10 bg-white/[0.025] px-4 py-3 text-left text-white hover:border-[#9cff57]/35 hover:bg-[#9cff57]/[0.06] hover:text-white"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-[#9cff57]/20 bg-[#9cff57]/[0.08] text-[#9cff57]">
                <Wallet className="size-4" />
              </span>
              <span className="min-w-0">
                <strong className="block truncate text-sm">{wallet.name}</strong>
                <small className="mt-0.5 block text-xs font-normal text-white/45">Injected browser wallet</small>
              </span>
            </Button>
          ))}
        </div>
        <p className="flex items-start gap-2 text-xs leading-relaxed text-white/45">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[#9cff57]" />
          SportPad requests a public address and signature only. Private keys and seed phrases stay inside your wallet.
        </p>
      </DialogContent>
    </Dialog>
  );
}

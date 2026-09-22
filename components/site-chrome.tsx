"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  BookOpen,
  ChartNoAxesCombined,
  CircleGauge,
  GitFork,
  Goal,
  Menu,
  LogIn,
  LogOut,
  ShieldCheck,
  Sparkles,
  Trophy,
  UserRound,
  Wallet,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { SiteLink as Link } from "@/components/site-link";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { fanAssets } from "@/lib/site-data";
import { SolanaWalletSessionProvider, useSolanaWalletSession } from "@/components/solana-wallet-session";

const navigation = [
  { href: "/discover", label: "Discover" },
  { href: "/fan-tokens", label: "Fan tokens" },
  { href: "/matchday", label: "Matchday" },
  { href: "/rewards", label: "Rewards" },
  { href: "/transparency", label: "Transparency" },
  { href: "/learn", label: "Learn" },
];

type WebMCPTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: Record<string, unknown>) => unknown | Promise<unknown>;
};

function WalletButton({ pathname }: { pathname: string }) {
  const { wallet, busy, message, messageTone, providerAvailable, connectAndVerify, disconnect } = useSolanaWalletSession();
  const [accountStatus, setAccountStatus] = useState<"loading" | "signed_in" | "signed_out">("loading");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/account", { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() as Promise<{ authenticated?: boolean }> : Promise.reject(new Error("Account unavailable")))
      .then((body) => setAccountStatus(body.authenticated === true ? "signed_in" : "signed_out"))
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setAccountStatus("signed_out");
      });
    return () => controller.abort();
  }, []);

  if (accountStatus === "loading") {
    return <Button disabled aria-label="Checking wallet access" variant="outline" className="header-wallet rounded-full border-white/10 bg-white/[0.04] text-white"><Wallet className="size-4" /><span>Wallet</span></Button>;
  }

  if (accountStatus === "signed_out") {
    const returnTo = pathname.startsWith("/") && !pathname.startsWith("//") ? pathname : "/";
    return (
      <Button asChild variant="outline" className="header-wallet rounded-full border-white/10 bg-white/[0.04] text-white hover:bg-white/10 hover:text-white">
        <a href={`/signin-with-chatgpt?return_to=${encodeURIComponent(returnTo)}`}><Wallet className="size-4" /><span>Sign in to connect</span></a>
      </Button>
    );
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button aria-label={wallet ? `Verified wallet ${wallet}` : "Connect wallet"} variant="outline" className="header-wallet rounded-full border-white/10 bg-white/[0.04] text-white hover:bg-white/10 hover:text-white">
          <Wallet className="size-4" />
          <span>{wallet ? `${wallet.slice(0, 4)}...${wallet.slice(-4)}` : "Connect wallet"}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="border-white/10 bg-[#0b100d] text-white sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Verify one Solana wallet</DialogTitle>
          <DialogDescription className="leading-relaxed text-white/45">
            Sign one plain-text challenge to prove wallet ownership. The signature creates a private SportPad session and does not authorize a transaction or spend SOL.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 rounded-2xl border border-white/8 bg-white/[0.025] p-4 text-sm text-white/50">
          <p className="flex items-center gap-2 text-white/80"><ShieldCheck className="size-4 text-[#9cff57]" /> Every mainnet transaction requires a separate wallet approval.</p>
          <p>SportPad never asks for a seed phrase or private key. Wallet sessions expire automatically.</p>
          {!providerAvailable ? <p className="text-[#ffcf66]">Install or enable a compatible injected Solana wallet in this browser.</p> : null}
          {wallet ? <p className="break-all font-mono text-xs text-white/65">{wallet}</p> : null}
        </div>
        {message ? <p role="status" className={`text-sm ${messageTone === "success" ? "text-[#a9ff74]" : messageTone === "error" ? "text-[#ff8f94]" : "text-white/65"}`}>{message}</p> : null}
        {wallet ? <Button onClick={disconnect} disabled={busy} variant="outline" className="h-11 border-white/10 bg-white/[0.03] text-white hover:bg-white/10 hover:text-white">{busy ? "Disconnecting..." : "Disconnect or change wallet"}</Button> : <Button onClick={connectAndVerify} disabled={busy || !providerAvailable} className="h-11 bg-[#9cff57] font-semibold text-[#071008] hover:bg-[#adff7d]">{busy ? "Waiting for wallet..." : "Connect and verify"}</Button>}
      </DialogContent>
    </Dialog>
  );
}

function AccountButton({ pathname }: { pathname: string }) {
  const [status, setStatus] = useState<"loading" | "signed_in" | "signed_out">("loading");
  const [operator, setOperator] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/account", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Account status could not be loaded.");
        return response.json() as Promise<{ authenticated?: boolean; isOperator?: boolean }>;
      })
      .then((body) => {
        setOperator(body.isOperator === true);
        setStatus(body.authenticated === true ? "signed_in" : "signed_out");
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setStatus("signed_out");
      });
    return () => controller.abort();
  }, []);

  const returnTo = pathname.startsWith("/") && !pathname.startsWith("//") ? pathname : "/";
  const signInPath = `/signin-with-chatgpt?return_to=${encodeURIComponent(returnTo)}`;
  const signOutPath = `/signout-with-chatgpt?return_to=${encodeURIComponent("/")}`;

  if (status === "signed_out") {
    return (
      <Button asChild variant="outline" className="header-account rounded-full border-white/10 bg-white/[0.04] text-white hover:bg-white/10 hover:text-white">
        <a href={signInPath}><LogIn className="size-4" /><span>Sign in</span></a>
      </Button>
    );
  }

  if (status === "loading") {
    return (
      <Button disabled aria-label="Checking sign-in status" variant="outline" className="header-account rounded-full border-white/10 bg-white/[0.04] text-white">
        <UserRound className="size-4" /><span>Account</span>
      </Button>
    );
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button aria-label="SportPad account signed in" variant="outline" className="header-account rounded-full border-[#9cff57]/20 bg-[#9cff57]/[0.06] text-white hover:bg-[#9cff57]/10 hover:text-white">
          <UserRound className="size-4 text-[#9cff57]" /><span>Signed in</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="border-white/10 bg-[#0b100d] text-white sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>SportPad account</DialogTitle>
          <DialogDescription className="leading-relaxed text-white/45">
            You are signed in. Drafts stay private until reviewed and verified onchain.
          </DialogDescription>
        </DialogHeader>
        <Button asChild variant="outline" className="h-11 border-white/10 bg-white/[0.03] text-white hover:bg-white/10 hover:text-white">
          <a href={signOutPath}><LogOut className="size-4" /> Sign out</a>
        </Button>
        {operator ? <Button asChild className="h-11 bg-[#9cff57] font-semibold text-[#071008] hover:bg-[#adff7d]"><Link href="/operator">Open operator console</Link></Button> : null}
      </DialogContent>
    </Dialog>
  );
}

function WebMCPRegistry() {
  useEffect(() => {
    const modelContext = (document as Document & {
      modelContext?: { registerTool: (tool: WebMCPTool, options?: { signal?: AbortSignal }) => Promise<void> };
    }).modelContext;
    if (!modelContext) return;

    const controller = new AbortController();
    const pages = ["discover", "fan-tokens", "matchday", "rewards", "how-it-works", "transparency", "learn", "sport", "policy", "launch"];
    Promise.all([
      modelContext.registerTool({
        name: "sportpad_open_page",
        description: "Open a primary SportPad product page.",
        inputSchema: {
          type: "object",
          properties: { page: { type: "string", enum: pages } },
          required: ["page"],
          additionalProperties: false,
        },
        execute: ({ page }) => {
          const destination = typeof page === "string" && pages.includes(page) ? `/${page}` : "/";
          // Native navigation is intentional: the deployed Vinext Link runtime
          // currently throws during client-side route transitions.
          window.location.assign(destination);
          return { content: [{ type: "text", text: `Opened ${destination}.` }] };
        },
      }, { signal: controller.signal }),
      modelContext.registerTool({
        name: "sportpad_search_launches",
        description: "Open Discover with a launch, ticker, sport, or reward-token search.",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string", minLength: 1, maxLength: 80 } },
          required: ["query"],
          additionalProperties: false,
        },
        execute: ({ query }) => {
          const value = typeof query === "string" ? query.slice(0, 80) : "";
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.assign(`/discover?q=${encodeURIComponent(value)}`);
          return { content: [{ type: "text", text: `Searching SportPad for ${value}.` }] };
        },
      }, { signal: controller.signal }),
    ]).catch((error) => console.warn("webmcp_registration_failed", error));
    return () => controller.abort();
  }, []);

  return null;
}

function SiteChromeContent({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="site-root" onPointerMove={(event) => {
      event.currentTarget.style.setProperty("--mouse-x", `${event.clientX}px`);
      event.currentTarget.style.setProperty("--mouse-y", `${event.clientY}px`);
    }}>
      <WebMCPRegistry />
      <a className="skip-link" href="#main-content">Skip to content</a>
      <div className="pointer-glow" aria-hidden="true" />
      <div className="pitch-grid" aria-hidden="true" />
      <div className="ticker-rail" aria-label="Official Fan Tokens with registry-listed Solana token addresses">
        <div className="ticker-track">
          {[...fanAssets.slice(0, 24), ...fanAssets.slice(0, 24)].map((asset, index) => (
            <span key={`${asset.symbol}-${index}`}><span className="ticker-dot" /> {asset.symbol} · OFFICIAL FAN TOKEN · SOLANA</span>
          ))}
        </div>
      </div>
      <header className="global-header">
        <Link href="/" className="brand" aria-label="SportPad home">
          <span className="brand-mark"><Goal /></span><span>SPORT<span>PAD</span></span>
        </Link>
        <nav className="desktop-nav" aria-label="Primary navigation">
          {navigation.map((item) => (
            <Link key={item.href} href={item.href} className={pathname.startsWith(item.href) ? "active" : ""}>{item.label}</Link>
          ))}
        </nav>
        <div className="header-actions">
          <div className="network-pill"><span /> Solana</div>
          <a className="github-header-link" href="https://github.com/technomozart/sportpad.fun" target="_blank" rel="noopener noreferrer" aria-label="SportPad source code on GitHub"><GitFork /><span>GitHub</span></a>
          <AccountButton pathname={pathname} />
          <WalletButton pathname={pathname} />
          <Button asChild className="hidden rounded-full bg-[#9cff57] font-semibold text-[#071008] hover:bg-[#adff7d] xl:inline-flex">
            <Link href="/launch"><Sparkles className="size-4" /> Build draft</Link>
          </Button>
          <button className="mobile-menu-button" onClick={() => setMenuOpen((value) => !value)} aria-label="Toggle menu" aria-expanded={menuOpen}>
            {menuOpen ? <X /> : <Menu />}
          </button>
        </div>
      </header>
      {menuOpen ? (
        <div className="mobile-menu">
          {navigation.map((item) => <Link key={item.href} href={item.href} className={pathname.startsWith(item.href) ? "active" : ""} onClick={() => setMenuOpen(false)}>{item.label}</Link>)}
          <a href="https://github.com/technomozart/sportpad.fun" target="_blank" rel="noopener noreferrer"><GitFork /> GitHub / source code</a>
          <Link href="/launch" onClick={() => setMenuOpen(false)} className="mobile-launch">Start a draft</Link>
        </div>
      ) : null}
      <div id="main-content" tabIndex={-1}>{children}</div>
      <footer className="global-footer">
        <div className="footer-grid">
          <div className="footer-intro">
            <Link href="/" className="brand"><span className="brand-mark"><Goal /></span><span>SPORT<span>PAD</span></span></Link>
            <p>Launch community tokens whose fees fund official Fan Token rewards and SPORTPAD buyback and burn. SPORTPAD&apos;s own fees fund project development.</p>
            <div className="footer-badges"><span><CircleGauge /> Solana-native</span><span><ShieldCheck /> Planned routes shown</span></div>
          </div>
          <div><h3>Product</h3><Link href="/discover">Discover</Link><Link href="/launch">Draft builder</Link><Link href="/rewards">Rewards</Link><Link href="/matchday">Matchday</Link></div>
          <div><h3>Protocol</h3><Link href="/how-it-works">How it works</Link><Link href="/transparency">Capital flow</Link><Link href="/fan-tokens">Reward registry</Link><Link href="/sport">SPORTPAD status</Link><Link href="/transparency#status">System status</Link></div>
          <div><h3>Learn</h3><Link href="/learn"><BookOpen /> Guides</Link><Link href="/learn#faq">FAQ</Link><Link href="/learn#glossary">Glossary</Link><Link href="/learn#risk">Risk disclosure</Link><Link href="/policy">Creator policy</Link><a href="https://github.com/technomozart/sportpad.fun" target="_blank" rel="noopener noreferrer"><GitFork /> Source code</a></div>
        </div>
        <div className="footer-bottom">
          <p>Official Fan Token names, images, and Solana token addresses come from published FanTokens and Chiliz sources. Fan Tokens are rooted in the Chiliz ecosystem and use an omnichain supply model. SportPad community tokens remain separate creator-made assets.</p>
          <p>Digital assets are volatile and may lose all value. Check the live system status before signing any mainnet transaction.</p>
        </div>
      </footer>
      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        <Link href="/discover" className={pathname.startsWith("/discover") ? "active" : ""}><ChartNoAxesCombined /><span>Discover</span></Link>
        <Link href="/matchday" className={pathname.startsWith("/matchday") ? "active" : ""}><Trophy /><span>Matchday</span></Link>
        <Link href="/launch" className={`mobile-bottom-launch ${pathname.startsWith("/launch") ? "active" : ""}`}><Sparkles /><span>Draft</span></Link>
        <Link href="/rewards" className={pathname.startsWith("/rewards") ? "active" : ""}><Goal /><span>Rewards</span></Link>
        <Link href="/learn" className={pathname.startsWith("/learn") ? "active" : ""}><BookOpen /><span>Learn</span></Link>
      </nav>
    </div>
  );
}

export function SiteChrome({ children }: { children: ReactNode }) {
  return <SolanaWalletSessionProvider><SiteChromeContent>{children}</SiteChromeContent></SolanaWalletSessionProvider>;
}

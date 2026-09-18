"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  BookOpen,
  ChartNoAxesCombined,
  CircleGauge,
  Goal,
  Menu,
  ShieldCheck,
  Sparkles,
  Trophy,
  Wallet,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { fanAssets } from "@/lib/site-data";

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

function WalletButton() {
  const [address, setAddress] = useState("");
  const [message, setMessage] = useState("");
  const [connecting, setConnecting] = useState(false);

  async function connectWallet() {
    setConnecting(true);
    setMessage("");
    try {
      const browser = window as typeof window & {
        solana?: { connect: () => Promise<{ publicKey: { toString: () => string } }> };
        phantom?: { solana?: { connect: () => Promise<{ publicKey: { toString: () => string } }> } };
      };
      const provider = browser.phantom?.solana ?? browser.solana;
      if (!provider) throw new Error("No compatible injected Solana wallet was detected in this browser.");
      const result = await provider.connect();
      setAddress(result.publicKey.toString());
      setMessage("Connected for this browser session.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Wallet connection failed.");
    } finally {
      setConnecting(false);
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" className="header-wallet rounded-full border-white/10 bg-white/[0.04] text-white hover:bg-white/10 hover:text-white">
          <Wallet className="size-4" />
          <span>{address ? `${address.slice(0, 4)}…${address.slice(-4)}` : "Connect wallet"}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="border-white/10 bg-[#0b100d] text-white sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Connect one Solana wallet</DialogTitle>
          <DialogDescription className="leading-relaxed text-white/45">
            Your wallet holds community tokens and receives supported fan-token claims. SportPad never asks for a seed phrase or private key.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 rounded-2xl border border-white/8 bg-white/[0.025] p-4 text-sm text-white/50">
          <p className="flex items-center gap-2 text-white/80"><ShieldCheck className="size-4 text-[#9cff57]" /> You approve every transaction.</p>
          <p>This early preview connects only to a compatible wallet provider already injected into the page.</p>
        </div>
        {message ? <p role="status" className={`text-sm ${address ? "text-[#a9ff74]" : "text-[#ff8f94]"}`}>{message}</p> : null}
        <Button onClick={connectWallet} disabled={connecting || Boolean(address)} className="h-11 bg-[#9cff57] font-semibold text-[#071008] hover:bg-[#adff7d]">
          {connecting ? "Connecting…" : address ? "Wallet connected" : "Connect detected wallet"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function WebMCPRegistry() {
  const router = useRouter();

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
          router.push(destination);
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
          router.push(`/discover?q=${encodeURIComponent(value)}`);
          return { content: [{ type: "text", text: `Searching SportPad for ${value}.` }] };
        },
      }, { signal: controller.signal }),
    ]).catch((error) => console.warn("webmcp_registration_failed", error));
    return () => controller.abort();
  }, [router]);

  return null;
}

export function SiteChrome({ children }: { children: ReactNode }) {
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
      <div className="ticker-rail" aria-label="Verified reward asset examples">
        <div className="ticker-track">
          {[...fanAssets, ...fanAssets].map((asset, index) => (
            <span key={`${asset.symbol}-${index}`}><span className="ticker-dot" /> {asset.symbol} · {asset.status.toUpperCase()}</span>
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
          <WalletButton />
          <Button asChild className="hidden rounded-full bg-[#9cff57] font-semibold text-[#071008] hover:bg-[#adff7d] xl:inline-flex">
            <Link href="/launch"><Sparkles className="size-4" /> Launch</Link>
          </Button>
          <button className="mobile-menu-button" onClick={() => setMenuOpen((value) => !value)} aria-label="Toggle menu" aria-expanded={menuOpen}>
            {menuOpen ? <X /> : <Menu />}
          </button>
        </div>
      </header>
      {menuOpen ? (
        <div className="mobile-menu">
          {navigation.map((item) => <Link key={item.href} href={item.href} className={pathname.startsWith(item.href) ? "active" : ""} onClick={() => setMenuOpen(false)}>{item.label}</Link>)}
          <Link href="/launch" onClick={() => setMenuOpen(false)} className="mobile-launch">Launch a token</Link>
        </div>
      ) : null}
      <div id="main-content" tabIndex={-1}>{children}</div>
      <footer className="global-footer">
        <div className="footer-grid">
          <div className="footer-intro">
            <Link href="/" className="brand"><span className="brand-mark"><Goal /></span><span>SPORT<span>PAD</span></span></Link>
            <p>Launch community tokens on Solana and route creator-fee value into verified sports fan-token rewards.</p>
            <div className="footer-badges"><span><CircleGauge /> Solana-native</span><span><ShieldCheck /> Verifiable routes</span></div>
          </div>
          <div><h3>Product</h3><Link href="/discover">Discover</Link><Link href="/launch">Launch</Link><Link href="/rewards">Rewards</Link><Link href="/matchday">Matchday</Link></div>
          <div><h3>Protocol</h3><Link href="/how-it-works">How it works</Link><Link href="/transparency">Capital flow</Link><Link href="/fan-tokens">Reward registry</Link><Link href="/sport">SPORT status</Link><Link href="/transparency#status">System status</Link></div>
          <div><h3>Learn</h3><Link href="/learn"><BookOpen /> Guides</Link><Link href="/learn#faq">FAQ</Link><Link href="/learn#glossary">Glossary</Link><Link href="/learn#risk">Risk disclosure</Link><Link href="/policy">Creator policy</Link></div>
        </div>
        <div className="footer-bottom">
          <p>Community-created tokens are not club-issued. SportPad is not affiliated with or endorsed by any club, league, Chiliz, Socios.com, or FanTokens.</p>
          <p>Digital assets are volatile and may lose all value. Demo market data is illustrative.</p>
        </div>
      </footer>
      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        <Link href="/discover" className={pathname.startsWith("/discover") ? "active" : ""}><ChartNoAxesCombined /><span>Discover</span></Link>
        <Link href="/matchday" className={pathname.startsWith("/matchday") ? "active" : ""}><Trophy /><span>Matchday</span></Link>
        <Link href="/launch" className={`mobile-bottom-launch ${pathname.startsWith("/launch") ? "active" : ""}`}><Sparkles /><span>Launch</span></Link>
        <Link href="/rewards" className={pathname.startsWith("/rewards") ? "active" : ""}><Goal /><span>Rewards</span></Link>
        <Link href="/learn" className={pathname.startsWith("/learn") ? "active" : ""}><BookOpen /><span>Learn</span></Link>
      </nav>
    </div>
  );
}

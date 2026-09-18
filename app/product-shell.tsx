"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  ChevronDown,
  CircleDollarSign,
  Flame,
  Goal,
  Search,
  ShieldCheck,
  Sparkles,
  Trophy,
  Wallet,
  Zap,
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
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Launch = {
  name: string;
  ticker: string;
  reward: string;
  tone: string;
  marketCap: string;
  change: string;
  curve: number;
  rewards: string;
  activity: number[];
};

const launches: Launch[] = [
  { name: "Catalan Cats", ticker: "CATALA", reward: "BAR", tone: "#9cff57", marketCap: "$184K", change: "+31.4%", curve: 72, rewards: "428 BAR", activity: [18, 34, 30, 55, 48, 72, 65, 88, 79, 95] },
  { name: "Paris Ultras", ticker: "ULTRA", reward: "PSG", tone: "#72a7ff", marketCap: "$96K", change: "+18.8%", curve: 46, rewards: "211 PSG", activity: [24, 42, 38, 31, 60, 54, 74, 67, 83, 78] },
  { name: "Cityzens Onchain", ticker: "CITYZ", reward: "CITY", tone: "#66e4ff", marketCap: "$71K", change: "+9.6%", curve: 38, rewards: "186 CITY", activity: [12, 24, 22, 44, 37, 53, 49, 68, 61, 72] },
  { name: "Rossoneri Run", ticker: "ROSSO", reward: "ACM", tone: "#ff6666", marketCap: "$42K", change: "+6.2%", curve: 24, rewards: "94 ACM", activity: [18, 15, 32, 27, 48, 42, 38, 59, 55, 64] },
];

const fanTicker = ["BAR", "PSG", "CITY", "ACM", "ATM", "AFC", "JUV", "POR"];

type WebMCPTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: Record<string, unknown>) => unknown | Promise<unknown>;
};

function MiniChart({ values, color }: { values: number[]; color: string }) {
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 100},${100 - value}`).join(" ");
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-12 w-full" aria-hidden="true">
      <polyline points={points} fill="none" stroke={color} strokeWidth="3" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TokenMark({ token, color }: { token: string; color: string }) {
  return (
    <div className="token-mark" style={{ "--token-color": color } as CSSProperties} aria-hidden="true">
      <span>{token.slice(0, 2)}</span>
    </div>
  );
}

function LaunchCard({ launch }: { launch: Launch }) {
  return (
    <article className="launch-card group">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <TokenMark token={launch.ticker} color={launch.tone} />
          <div className="min-w-0">
            <h3 className="truncate text-[1rem] font-semibold tracking-[-0.02em] text-white">{launch.name}</h3>
            <p className="mt-0.5 text-xs font-medium tracking-[0.05em] text-white/40">${launch.ticker}</p>
          </div>
        </div>
        <span className="rounded-full border border-emerald-300/15 bg-emerald-300/8 px-2.5 py-1 text-xs font-semibold text-[#a9ff74]">{launch.change}</span>
      </div>
      <div className="mt-6 grid grid-cols-[1fr_112px] items-end gap-5">
        <div><p className="data-label">Market cap</p><p className="mt-1 text-2xl font-semibold tracking-[-0.05em] text-white">{launch.marketCap}</p></div>
        <MiniChart values={launch.activity} color={launch.tone} />
      </div>
      <div className="my-5 h-px bg-white/[0.07]" />
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2"><span className="reward-dot" style={{ background: launch.tone }} /><p className="truncate text-sm text-white/68">Earn <strong className="font-semibold text-white">{launch.reward}</strong></p></div>
        <p className="shrink-0 text-xs text-white/36">{launch.rewards} funded</p>
      </div>
      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between text-xs text-white/42"><span>Bonding curve</span><span>{launch.curve}%</span></div>
        <Progress value={launch.curve} className="h-1.5 bg-white/8 [&_[data-slot=progress-indicator]]:bg-[#8cff4f]" />
      </div>
    </article>
  );
}

function WalletDialog() {
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
      if (!provider) throw new Error("No injected Solana wallet was detected. Install Phantom, Solflare, Backpack, or a compatible wallet.");
      const result = await provider.connect();
      const nextAddress = result.publicKey.toString();
      if (!nextAddress) throw new Error("The wallet did not return a Solana address.");
      setAddress(nextAddress);
      setMessage("Wallet connected for this browser session.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The wallet could not be connected.");
    } finally {
      setConnecting(false);
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" className="rounded-full border-white/10 bg-white/[0.04] text-white hover:bg-white/10 hover:text-white">
          <Wallet /> {address ? `${address.slice(0, 4)}…${address.slice(-4)}` : "Connect wallet"}
        </Button>
      </DialogTrigger>
      <DialogContent className="border-white/10 bg-[#0b100d] text-white sm:max-w-[440px]">
        <DialogHeader><DialogTitle>Connect one Solana wallet</DialogTitle><DialogDescription className="leading-relaxed text-white/45">The same address can hold the launch token and claim official Fan Token rewards on Solana. SportPad never asks for a seed phrase.</DialogDescription></DialogHeader>
        <div className="mt-2 rounded-xl border border-white/8 bg-white/[0.025] p-4 text-sm text-white/50">Phantom, Solflare, Backpack, and compatible injected Solana wallets are supported in this prototype.</div>
        {message ? <p role="status" className={`text-sm ${address ? "text-[#a9ff74]" : "text-[#ff8f94]"}`}>{message}</p> : null}
        <Button onClick={connectWallet} disabled={connecting || Boolean(address)} className="h-11 bg-[#9cff57] font-semibold text-[#071008] hover:bg-[#adff7d]">{connecting ? "Connecting…" : address ? "Connected" : "Connect detected wallet"}</Button>
      </DialogContent>
    </Dialog>
  );
}

function LaunchDialog() {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [rewardSymbol, setRewardSymbol] = useState("PSG");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveMessage, setSaveMessage] = useState("");

  async function saveDraft() {
    setSaveState("saving");
    setSaveMessage("");
    try {
      const response = await fetch("/api/launch-drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, symbol, rewardSymbol }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "The draft could not be saved.");
      setSaveState("saved");
      setSaveMessage("Draft saved. Mainnet execution remains locked.");
    } catch (error) {
      setSaveState("error");
      setSaveMessage(error instanceof Error ? error.message : "The draft could not be saved.");
    }
  }

  return (
    <Dialog onOpenChange={(open) => { if (!open) { setStep(1); setSaveState("idle"); setSaveMessage(""); } }}>
      <DialogTrigger asChild>
        <Button className="h-11 rounded-full bg-[#9cff57] px-5 font-semibold text-[#071008] shadow-[0_0_30px_rgba(156,255,87,.18)] hover:bg-[#adff7d]"><Sparkles className="size-4" /> Launch a coin</Button>
      </DialogTrigger>
      <DialogContent className="border-white/10 bg-[#0b100d] p-0 text-white shadow-2xl sm:max-w-[560px]">
        <div className="border-b border-white/8 px-6 py-5">
          <DialogHeader>
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#9cff57]"><span>Launch builder</span><span className="text-white/25">0{step} / 02</span></div>
            <DialogTitle className="text-2xl tracking-[-0.04em]">{step === 1 ? "Pair your coin with fandom" : "Your reward route"}</DialogTitle>
            <DialogDescription className="text-sm leading-relaxed text-white/45">{step === 1 ? "Choose the Solana coin and fan token that its activity will fund." : "Every creator-fee settlement follows the same visible split."}</DialogDescription>
          </DialogHeader>
        </div>
        {step === 1 ? (
          <div className="space-y-5 px-6 py-6">
            <label className="field-label">Coin name<Input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. The 12th Player" className="mt-2 h-11 border-white/10 bg-white/[0.04] text-white placeholder:text-white/25" /></label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="field-label">Ticker<Input value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10))} placeholder="PLAYER" className="mt-2 h-11 border-white/10 bg-white/[0.04] text-white placeholder:text-white/25" /></label>
              <label className="field-label">Fan-token reward<span className="relative mt-2 block"><select value={rewardSymbol} onChange={(event) => setRewardSymbol(event.target.value)} className="h-11 w-full appearance-none rounded-md border border-white/10 bg-[#101712] px-3 text-sm text-white outline-none focus:border-[#9cff57]/60"><option value="PSG">PSG · routed on Solana</option><option value="AFC">AFC · routed on Solana</option><option value="BAR">BAR · inventory required</option><option value="CITY">CITY · inventory required</option><option value="ACM">ACM · inventory required</option></select><ChevronDown className="pointer-events-none absolute right-3 top-3.5 size-4 text-white/35" /></span></label>
            </div>
            <div className="rounded-xl border border-white/8 bg-white/[0.025] p-4 text-sm leading-relaxed text-white/50">This private prototype creates a launch draft only. Mainnet creation stays locked until contracts, liquidity routing, and compliance review are complete.</div>
            <Button disabled={name.trim().length < 2 || symbol.length < 2} onClick={() => setStep(2)} className="h-12 w-full rounded-xl bg-[#9cff57] font-semibold text-[#071008] hover:bg-[#adff7d]">Review fee routing <ArrowRight /></Button>
          </div>
        ) : (
          <div className="space-y-4 px-6 py-6">
            <div className="route-row"><div className="route-icon"><Trophy /></div><div><p className="font-semibold">80% · fan-token rewards</p><p>Swapped into the selected reward asset and reserved for eligible holders.</p></div></div>
            <div className="route-row"><div className="route-icon"><Flame /></div><div><p className="font-semibold">20% · SPORT buyback</p><p>Used to buy the platform token and send it to a verifiable burn address.</p></div></div>
            <div className="rounded-xl border border-white/8 bg-black/20 px-4 py-3 text-sm text-white/50"><strong className="text-white">${symbol}</strong> will accrue rewards in <strong className="text-white">{rewardSymbol}</strong>. This is a linked reward, not a literal trading pair.</div>
            {saveMessage ? <p role="status" className={`text-sm ${saveState === "error" ? "text-[#ff8f94]" : "text-[#a9ff74]"}`}>{saveMessage}</p> : null}
            <div className="flex gap-3 pt-2"><Button variant="outline" onClick={() => setStep(1)} className="h-12 flex-1 border-white/10 bg-transparent text-white hover:bg-white/5 hover:text-white">Back</Button><Button onClick={saveDraft} disabled={saveState === "saving" || saveState === "saved"} className="h-12 flex-[1.6] bg-white font-semibold text-black hover:bg-white/90">{saveState === "saving" ? "Saving…" : saveState === "saved" ? "Draft saved" : "Save private draft"}</Button></div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RewardsPreview() {
  const [demo, setDemo] = useState(false);
  if (!demo) {
    return (
      <div className="empty-rewards">
        <div className="mx-auto grid size-14 place-items-center rounded-2xl border border-white/10 bg-white/[0.04]"><Wallet className="size-6 text-[#9cff57]" /></div>
        <h3 className="mt-5 text-xl font-semibold tracking-[-0.03em]">See rewards from one Solana wallet</h3>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-white/45">Your holdings, reward checkpoints, and claim destination will live here. Preview the dashboard without connecting a wallet.</p>
        <Button onClick={() => setDemo(true)} className="mt-5 rounded-full bg-white text-black hover:bg-white/90">Preview dashboard</Button>
      </div>
    );
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
      <div className="panel-card p-5 sm:p-6">
        <div className="flex items-center justify-between"><div><p className="data-label">Claimable rewards</p><p className="mt-2 text-4xl font-semibold tracking-[-0.06em]">$286.42</p></div><span className="demo-pill">Demo wallet</span></div>
        <div className="mt-7 space-y-3">
          {[{t:"BAR",a:"18.42",v:"$74.88",c:"#9cff57"},{t:"PSG",a:"9.73",v:"$51.20",c:"#72a7ff"},{t:"CITY",a:"41.05",v:"$160.34",c:"#66e4ff"}].map((item) => (
            <div key={item.t} className="flex items-center gap-3 rounded-xl border border-white/7 bg-black/20 p-3.5"><TokenMark token={item.t} color={item.c} /><div className="min-w-0 flex-1"><p className="font-semibold">{item.a} {item.t}</p><p className="text-xs text-white/35">Next checkpoint in 04:18:12</p></div><p className="text-sm text-white/55">{item.v}</p></div>
          ))}
        </div>
      </div>
      <div className="panel-card flex flex-col p-5 sm:p-6"><div className="flex items-center gap-2 text-[#9cff57]"><ShieldCheck className="size-4"/><span className="text-xs font-semibold uppercase tracking-[0.14em]">Destination</span></div><h3 className="mt-4 text-xl font-semibold tracking-[-0.03em]">One Solana address</h3><p className="mt-2 text-sm leading-relaxed text-white/44">Official Fan Tokens now have Solana mints. Eligible rewards go to the same connected wallet; cross-chain inventory stays behind the scenes.</p><div className="mt-auto pt-7"><Button variant="outline" className="w-full border-white/10 bg-white/[0.03] text-white hover:bg-white/8 hover:text-white">Verify wallet</Button></div></div>
    </div>
  );
}

export function ProductShell() {
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState("markets");
  const filtered = useMemo(() => launches.filter((launch) => `${launch.name} ${launch.ticker} ${launch.reward}`.toLowerCase().includes(query.toLowerCase())), [query]);

  useEffect(() => {
    const modelContext = (document as Document & {
      modelContext?: { registerTool: (tool: WebMCPTool, options?: { signal?: AbortSignal }) => Promise<void> };
    }).modelContext;
    if (!modelContext) return;

    const controller = new AbortController();
    const registrations = [
      modelContext.registerTool({
        name: "sportpad_search_launches",
        description: "Filter the visible SportPad concept launches by coin name, ticker, or Fan Token reward symbol.",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string", description: "Text such as PSG, CITY, or the launch name." } },
          required: ["query"],
          additionalProperties: false,
        },
        execute: ({ query: nextQuery }) => {
          const normalized = typeof nextQuery === "string" ? nextQuery.slice(0, 80) : "";
          setActiveTab("markets");
          setQuery(normalized);
          return { content: [{ type: "text", text: `Showing launches matching “${normalized}”.` }] };
        },
      }, { signal: controller.signal }),
      modelContext.registerTool({
        name: "sportpad_show_section",
        description: "Open the live markets, wallet rewards preview, or fee activity section in SportPad.",
        inputSchema: {
          type: "object",
          properties: { section: { type: "string", enum: ["markets", "rewards", "activity"] } },
          required: ["section"],
          additionalProperties: false,
        },
        execute: ({ section }) => {
          const nextSection = typeof section === "string" && ["markets", "rewards", "activity"].includes(section) ? section : "markets";
          setActiveTab(nextSection);
          return { content: [{ type: "text", text: `Opened the ${nextSection} section.` }] };
        },
      }, { signal: controller.signal }),
      modelContext.registerTool({
        name: "sportpad_create_launch_draft",
        description: "Save a private SportPad launch draft. This never creates a token or submits a mainnet transaction.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", minLength: 2, maxLength: 48 },
            symbol: { type: "string", pattern: "^[A-Za-z0-9]{2,10}$" },
            rewardSymbol: { type: "string", enum: ["PSG", "AFC", "BAR", "CITY", "ACM"] },
          },
          required: ["name", "symbol", "rewardSymbol"],
          additionalProperties: false,
        },
        execute: async ({ name, symbol, rewardSymbol }) => {
          const response = await fetch("/api/launch-drafts", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name, symbol, rewardSymbol }),
          });
          const result = (await response.json()) as { error?: string; draft?: { id: string; symbol: string } };
          if (!response.ok) throw new Error(result.error ?? "The launch draft could not be saved.");
          return { content: [{ type: "text", text: `Saved private draft $${result.draft?.symbol ?? symbol}. Mainnet execution remains locked.` }] };
        },
      }, { signal: controller.signal }),
    ];

    Promise.all(registrations).catch((error) => console.warn("webmcp_registration_failed", error));
    return () => controller.abort();
  }, []);

  return (
    <main className="min-h-screen overflow-hidden bg-[#070a08] text-white" onPointerMove={(event) => { const root = event.currentTarget; root.style.setProperty("--mouse-x", `${event.clientX}px`); root.style.setProperty("--mouse-y", `${event.clientY}px`); }}>
      <div className="pointer-glow" aria-hidden="true" /><div className="pitch-grid" aria-hidden="true" />
      <div className="ticker-rail" aria-label="Supported fan-token examples"><div className="ticker-track">{[...fanTicker, ...fanTicker].map((item, index) => <span key={`${item}-${index}`}><span className="ticker-dot" /> {item} REWARDS</span>)}</div></div>
      <header className="site-header">
        <a href="#top" className="brand" aria-label="SportPad home"><span className="brand-mark"><Goal /></span><span>SPORT<span>PAD</span></span></a>
        <nav className="hidden items-center gap-7 text-sm text-white/52 md:flex" aria-label="Primary navigation"><a href="#markets" onClick={() => setActiveTab("markets")} className="hover:text-white">Markets</a><a href="#markets" onClick={() => setActiveTab("rewards")} className="hover:text-white">Rewards</a><a href="#protocol" className="hover:text-white">Protocol</a></nav>
        <WalletDialog />
      </header>
      <section id="top" className="mx-auto max-w-[1240px] px-4 pb-20 pt-10 sm:px-6 lg:px-8 lg:pt-16">
        <div className="hero-grid">
          <div className="relative z-10">
            <div className="eyebrow"><span className="live-pulse" /> Solana launches · fan-token rewards</div>
            <h1 className="hero-title">Launch the game.<br/><span>Reward the stands.</span></h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-white/52 sm:text-lg">Create sports-native coins on Solana. Trading activity can fund official Fan Token rewards, while every fee movement stays visible.</p>
            <div className="mt-7 flex flex-wrap items-center gap-3"><LaunchDialog /><Button asChild variant="ghost" className="h-11 rounded-full px-5 text-white/68 hover:bg-white/6 hover:text-white"><a href="#markets">Explore launches <ArrowRight /></a></Button></div>
            <div className="mt-9 flex flex-wrap gap-x-7 gap-y-3 text-xs text-white/36"><span className="flex items-center gap-2"><BadgeCheck className="size-4 text-[#9cff57]" /> Fixed 80 / 20 routing</span><span className="flex items-center gap-2"><ShieldCheck className="size-4 text-[#9cff57]" /> One Solana wallet for claims</span></div>
          </div>
          <div className="stadium-orbit" aria-hidden="true"><div className="orbit orbit-one"><span /></div><div className="orbit orbit-two"><span /></div><div className="orbit-core"><Goal /></div><div className="orbit-copy orbit-copy-one"><small>FAN REWARDS</small><strong>80%</strong></div><div className="orbit-copy orbit-copy-two"><small>BUY + BURN</small><strong>20%</strong></div></div>
        </div>
        <div className="metrics-strip"><div><span>24</span><p>concept launches</p></div><div><span>$84.2K</span><p>rewards routed</p></div><div><span>100%</span><p>fees accounted for</p></div><div className="hidden sm:block"><span>Epoch-based</span><p>reward settlement</p></div></div>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-12" id="markets">
          <div className="flex flex-col gap-4 border-b border-white/8 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <TabsList variant="line" className="h-auto gap-6 p-0"><TabsTrigger value="markets" className="px-0 pb-3 text-sm data-[state=active]:text-white">Live markets</TabsTrigger><TabsTrigger value="rewards" className="px-0 pb-3 text-sm data-[state=active]:text-white">My rewards</TabsTrigger><TabsTrigger value="activity" className="px-0 pb-3 text-sm data-[state=active]:text-white">Fee activity</TabsTrigger></TabsList>
            <label className="relative block sm:w-[280px]"><Search className="absolute left-3 top-3 size-4 text-white/28" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search coin or fan token" className="h-10 rounded-full border-white/9 bg-white/[0.035] pl-10 text-white placeholder:text-white/25" /><span className="sr-only">Search launches</span></label>
          </div>
          <TabsContent value="markets" className="pt-5"><div className="mb-4 flex items-center justify-between"><p className="text-sm text-white/40">Concept data · reward pairs shown for product preview</p><span className="hidden items-center gap-1.5 text-xs text-white/35 sm:flex"><Activity className="size-3.5" /> Interactive preview</span></div><div className="grid gap-4 md:grid-cols-2">{filtered.map((launch) => <LaunchCard launch={launch} key={launch.ticker} />)}</div></TabsContent>
          <TabsContent value="rewards" className="pt-5" id="rewards"><RewardsPreview /></TabsContent>
          <TabsContent value="activity" className="pt-5"><div className="panel-card overflow-hidden">{[{icon:Trophy,label:"Fan reward reserve",amount:"+ 2.84 BAR",time:"14 sec ago"},{icon:Flame,label:"SPORT buyback queued",amount:"0.42 SOL",time:"31 sec ago"},{icon:CircleDollarSign,label:"Creator fee settled",amount:"2.10 SOL",time:"46 sec ago"}].map((item, index) => <div key={item.label} className={`flex items-center gap-4 p-4 sm:px-5 ${index ? "border-t border-white/7" : ""}`}><span className="grid size-9 place-items-center rounded-xl bg-white/[0.045]"><item.icon className="size-4 text-[#9cff57]" /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{item.label}</p><p className="mt-0.5 text-xs text-white/30">{item.time}</p></div><span className="text-sm font-medium text-white/65">{item.amount}</span></div>)}</div></TabsContent>
        </Tabs>
        <section id="protocol" className="mt-20 grid gap-4 lg:grid-cols-[.8fr_1.2fr]">
          <div className="p-2 lg:pr-12"><p className="eyebrow"><Zap className="size-3.5" /> One transparent route</p><h2 className="mt-5 text-3xl font-semibold tracking-[-0.055em] sm:text-4xl">From every trade to every supporter.</h2><p className="mt-4 text-sm leading-7 text-white/44">The final protocol will publish source transactions, swap receipts, reward checkpoints, and burn proofs. No hidden yield and no manual payout spreadsheet.</p></div>
          <div className="route-board"><div className="route-node"><small>01</small><strong>Creator fees</strong><span>Solana</span></div><ArrowRight className="route-arrow" /><div className="route-node route-node-accent"><small>02</small><strong>80 / 20 router</strong><span>Auditable split</span></div><ArrowRight className="route-arrow" /><div className="grid gap-2"><div className="route-node"><small>03A</small><strong>Fan rewards</strong><span>Solana first</span></div><div className="route-node"><small>03B</small><strong>Buy + burn</strong><span>SPORT</span></div></div></div>
        </section>
      </section>
      <footer className="border-t border-white/7 px-4 py-8 text-xs text-white/30 sm:px-6 lg:px-8"><div className="mx-auto flex max-w-[1240px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p>Private product prototype. Not affiliated with any club, league, Chiliz, Socios.com, or FanTokens.</p><p>Trading digital assets involves substantial risk.</p></div></footer>
    </main>
  );
}

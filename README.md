# SportPad

SportPad is a private product prototype for a Solana sports-token launchpad. Community tokens can be associated with verified official Fan Token reward assets. The intended creator-fee route is fixed at 80% for Fan Token inventory and 20% for SPORT buyback and burn.

The current build includes:

- a responsive dark stadium/trading interface across twelve product routes;
- searchable concept launches, matchday context, a Fan Token registry, and a wallet rewards preview;
- a four-step private launch-draft flow backed by D1;
- a verified Solana Fan Token mint registry with execution status;
- integer-safe 80/20 and time-weighted reward allocation logic;
- replay-safe settlement, reward epoch, and claim data models;
- native WebMCP tools for search, navigation, and private draft creation; and
- explicit mainnet execution locks and non-affiliation disclosures.

Mainnet token creation, fee collection, swaps, bridging, burns, and claims are intentionally disabled until keys are held in a policy-controlled signer, live routes pass canary tests, contracts are audited, and legal/commercial review is complete.

## Local development

```powershell
npm run install:ci
npm run dev
```

The local URL is printed by the development server. The bundled local sign-in flow is available at `/signin-with-chatgpt?return_to=/`.

## Verification

```powershell
npm run test:protocol
npm run test:providers
npm run lint
npx tsc --noEmit
npm run db:generate
npm run build
```

For the system design, risk controls, and staged launch plan, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). For the exact integration inputs needed in later phases, see [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md).

import { DIRECT_CHZ_OFT as SOURCE_ROUTE } from "./chiliz-direct-oft.ts";
import {
  DIRECT_CHZ_OFT as DESTINATION_ROUTE, verifyDirectOftDelivery,
  type DirectOftDeliveryProof,
} from "./direct-oft-receipts.ts";
import { verifyDirectOftSource,
  type VerifiedDirectOftSource } from "./direct-oft-source.ts";

const SCAN_TX_URL = "https://scan.layerzero-api.com/v1/messages/tx/";
const MINIMUM_SCALE = 10_000_000_000n;
const GUID = /^0x[0-9a-fA-F]{64}$/;
const POSITIVE = /^[1-9][0-9]*$/;
type RpcFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

/** The immutable intent fields selected from chiliz_bridge_journal. */
export type PreparedDirectOftJournalRow = Readonly<{
  id: string;
  sourceChain: string;
  destinationChainId: number;
  sourceMint: string;
  destinationAsset: string;
  routeType: string;
  sourceWallet: string;
  destinationTreasury: string;
  sourceAmountAtomic: string;
  minimumDestinationWei: string;
  quoteId: string;
  signedTransactionBase64: string;
  signedTransactionSha256: string;
  sourceSignature: string;
  bridgeMessageId?: string | null;
  sourceFinalizedSlot?: number | null;
  destinationTxHash?: string | null;
}>;

/** Independently retained from the local official OFT builder, never Scan. */
export type TrustedDirectOftSourceIntent = Readonly<{
  sourceTokenAccount: string;
  sourceEscrow: string;
  minimumDestinationWei: string;
  expectedMessageSha256: string;
}>;

export type ReconciledDirectOftEvidence = Readonly<{
  journalId: string;
  guid: string;
  source: VerifiedDirectOftSource["proof"];
  destination: DirectOftDeliveryProof & {
    finalized: true;
    chainId: typeof DESTINATION_ROUTE.destinationChainId;
    bridgeMessageId: string;
    destinationAsset: string;
    transactionHash: string;
    finalizedBlock: string;
  };
}>;

function fail(code: string): never { throw new Error(code); }

function record(value: unknown, code: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value as Record<string, unknown>;
}

function validateJournal(row: PreparedDirectOftJournalRow,
  trusted: TrustedDirectOftSourceIntent): bigint {
  if (typeof row.id !== "string" || !row.id || row.id.length > 128 ||
      row.sourceChain !== "solana" ||
      row.destinationChainId !== DESTINATION_ROUTE.destinationChainId ||
      row.sourceMint !== SOURCE_ROUTE.solanaMint ||
      row.destinationAsset !== "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" ||
      row.routeType !== "OFT" ||
      !POSITIVE.test(row.sourceAmountAtomic) ||
      !POSITIVE.test(row.minimumDestinationWei) ||
      row.minimumDestinationWei !== trusted.minimumDestinationWei) {
    fail("direct_oft_reconcile_journal_mismatch");
  }
  const minimum = BigInt(row.minimumDestinationWei);
  const parity = BigInt(row.sourceAmountAtomic) * MINIMUM_SCALE;
  if (minimum > parity || minimum * 100n < parity * 95n) {
    fail("direct_oft_reconcile_minimum_mismatch");
  }
  return minimum;
}

async function fetchScanMessage(sourceSignature: string,
  expectedGuid: string, fetchImpl: RpcFetch): Promise<unknown> {
  // The signature was authenticated from the exact signed Solana transaction.
  const url = `${SCAN_TX_URL}${encodeURIComponent(sourceSignature)}`;
  let response: Response;
  try {
    response = await fetchImpl(url, { method: "GET", headers: { Accept: "application/json" },
      redirect: "error", signal: AbortSignal.timeout(12_000) });
  } catch { return fail("direct_oft_reconcile_scan_unavailable"); }
  if (response.status === 404) fail("direct_oft_reconcile_scan_missing");
  if (!response.ok) fail("direct_oft_reconcile_scan_unavailable");
  let payload: unknown;
  try {
    const body = await response.text();
    if (body.length > 1_000_000) fail("direct_oft_reconcile_scan_invalid");
    payload = JSON.parse(body);
  } catch { return fail("direct_oft_reconcile_scan_invalid"); }
  const envelope = record(payload, "direct_oft_reconcile_scan_invalid");
  if (!Array.isArray(envelope.data)) fail("direct_oft_reconcile_scan_invalid");
  if (envelope.data.length === 0) fail("direct_oft_reconcile_scan_missing");
  if (envelope.data.length !== 1) fail("direct_oft_reconcile_scan_ambiguous");
  const message = record(envelope.data[0], "direct_oft_reconcile_scan_invalid");
  if (typeof message.guid !== "string" || !GUID.test(message.guid) ||
      message.guid.toLowerCase() !== expectedGuid) {
    fail("direct_oft_reconcile_scan_guid_mismatch");
  }
  return payload;
}

/**
 * Read-only reconciliation of a persisted direct-OFT intent. Scan is only an
 * index joining the source GUID to a destination tx; finalized Solana and two
 * independent Chiliz RPCs provide the actual on-chain evidence. The caller
 * must bind `trusted` to the same official builder plan as the journal row.
 */
export async function reconcileDirectOftChilizBridge(input: {
  journal: PreparedDirectOftJournalRow;
  trusted: TrustedDirectOftSourceIntent;
  solanaRpcUrl: string;
  primaryChilizRpcUrl: string;
  secondaryChilizRpcUrl: string;
  fetchImpl?: RpcFetch;
}): Promise<ReconciledDirectOftEvidence> {
  const minimum = validateJournal(input.journal, input.trusted);
  const source = await verifyDirectOftSource({
    rpcUrl: input.solanaRpcUrl,
    expected: {
      sourceSignature: input.journal.sourceSignature,
      sourceWallet: input.journal.sourceWallet,
      sourceTokenAccount: input.trusted.sourceTokenAccount,
      sourceEscrow: input.trusted.sourceEscrow,
      sourceMint: input.journal.sourceMint,
      sourceAmountAtomic: input.journal.sourceAmountAtomic,
      destinationTreasury: input.journal.destinationTreasury,
      minimumDestinationWei: input.journal.minimumDestinationWei,
      quoteId: input.journal.quoteId,
      signedTransactionBase64: input.journal.signedTransactionBase64,
      signedTransactionSha256: input.journal.signedTransactionSha256,
      expectedMessageSha256: input.trusted.expectedMessageSha256,
    },
    fetchImpl: input.fetchImpl,
  });
  if (input.journal.bridgeMessageId != null &&
      input.journal.bridgeMessageId.toLowerCase() !== source.guid ||
      input.journal.sourceFinalizedSlot != null &&
      input.journal.sourceFinalizedSlot !== source.finalizedSlot) {
    fail("direct_oft_reconcile_existing_source_mismatch");
  }
  const scanMessage = await fetchScanMessage(input.journal.sourceSignature,
    source.guid, input.fetchImpl ?? fetch);
  const delivery = await verifyDirectOftDelivery({
    scanMessage,
    expected: {
      sourceSignature: input.journal.sourceSignature,
      sourceTreasury: input.journal.sourceWallet,
      destinationTreasury: input.journal.destinationTreasury,
      minimumReceivedWei: minimum,
    },
    primaryRpcUrl: input.primaryChilizRpcUrl,
    secondaryRpcUrl: input.secondaryChilizRpcUrl,
    fetchImpl: input.fetchImpl,
  });
  if (delivery.guid !== source.guid ||
      input.journal.destinationTxHash != null &&
        input.journal.destinationTxHash.toLowerCase() !== delivery.destinationTransactionHash) {
    fail("direct_oft_reconcile_destination_mismatch");
  }
  return {
    journalId: input.journal.id,
    guid: source.guid,
    source: source.proof,
    destination: {
      ...delivery.proof,
      finalized: true,
      chainId: DESTINATION_ROUTE.destinationChainId,
      bridgeMessageId: source.guid,
      destinationAsset: input.journal.destinationAsset,
      transactionHash: delivery.destinationTransactionHash,
      finalizedBlock: delivery.proof.finalizedBlockNumber,
    },
  };
}

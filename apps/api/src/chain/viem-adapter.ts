import {
  BaseError, ContractFunctionRevertedError, createPublicClient, createWalletClient, hexToString, http, keccak256, NonceTooLowError, stringToHex, toHex,
  type Address, type Chain, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, hardhat } from "viem/chains";
import { REGISTRY_ABI } from "./registry-abi.js";
import type { ChainAdapter, TxResult } from "./adapter.js";

/**
 * Talks to a deployed CreditRegistry (Base Sepolia, or a local Hardhat node).
 * Every write is simulated first: a revert becomes { accepted: false, reason: <custom error> },
 * exactly like the mock ledger, so the engine treats both chains the same way.
 * Writes wait for their receipt, because the next action depends on the new state.
 */

const STATUS = { APPROVED: 1, REVIEW_REQUIRED: 2, REJECTED: 3 } as const;

/** Short IDs stay human-readable on the block explorer; longer ones are hashed. */
export const toBytes32 = (id: string): Hex => (id.length <= 31 ? stringToHex(id, { size: 32 }) : keccak256(toHex(id)));
const country = (code: string): Hex => stringToHex(code.slice(0, 2), { size: 2 });
/** Turns a bytes32 project ID in a revert back into readable text when it was a short ID. */
const readable = (arg: unknown): string => {
  if (typeof arg === "string" && /^0x[0-9a-f]{64}$/i.test(arg)) {
    const text = hexToString(arg as Hex, { size: 32 }).replace(/\0+$/, "");
    if (/^[\x20-\x7e]+$/.test(text)) return text;
  }
  return String(arg);
};
const asHash = (h: string): Hex => (/^0x[0-9a-f]{64}$/i.test(h) ? (h as Hex) : keccak256(toHex(h)));

/**
 * Public RPCs such as sepolia.base.org are load-balanced, and some nodes lag a block or two behind.
 * A read sent to a lagging node would not see our previous transaction (e.g. an attestation simulated
 * right after registerProject would revert with ProjectUnknown). So every simulation and gas estimate
 * is pinned to the block holding our latest transaction: a node either has that block (and therefore
 * our state) or answers "block not found", and we retry. Shared by all adapters, since all runs
 * use the same operator wallet.
 */
let lastBlock: bigint | undefined;
/** Next nonce for the operator wallet, tracked locally: a lagging node can report an old transaction count. */
let nextNonce = 0;
const RETRIES = 12;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retries a read that failed for a reason other than a contract revert (lagging node, rate limit, timeout). */
async function withRetry<T>(read: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await read();
    } catch (err) {
      const isRevert = err instanceof BaseError && err.walk((e) => e instanceof ContractFunctionRevertedError);
      if (isRevert || attempt >= RETRIES) throw err;
      await sleep(Math.min(500 * attempt, 3000));
    }
  }
}

export class ViemAdapter implements ChainAdapter {
  private readonly pub;
  private readonly wallet;

  constructor(private readonly address: Address, opts: { rpcUrl: string; privateKey: Hex; chain: Chain }) {
    const transport = http(opts.rpcUrl, { retryCount: 3 });
    this.pub = createPublicClient({ chain: opts.chain, transport });
    this.wallet = createWalletClient({ chain: opts.chain, transport, account: privateKeyToAccount(opts.privateKey) });
  }

  /**
   * Sends with an explicit nonce: the highest of the node's count and our own. If the node still
   * says the nonce was used (it lagged), take the next one and retry.
   */
  private async send(request: Record<string, unknown>): Promise<Hex> {
    const address = this.wallet.account.address;
    for (let attempt = 1; ; attempt++) {
      const reported = await withRetry(() => this.pub.getTransactionCount({ address, blockTag: "pending" }));
      const nonce = Math.max(reported, nextNonce);
      try {
        const hash = await this.wallet.writeContract({ ...request, nonce } as never);
        nextNonce = nonce + 1;
        return hash;
      } catch (err) {
        const tooLow = err instanceof BaseError && err.walk((e) => e instanceof NonceTooLowError);
        if (tooLow && attempt < RETRIES) { nextNonce = nonce + 1; await sleep(500); continue; }
        // A local Hardhat node mines a failing transaction and then reports an error: the nonce is used.
        if (err instanceof BaseError && err.walk((e) => typeof (e as { data?: { txHash?: unknown } }).data?.txHash === "string")) nextNonce = nonce + 1;
        throw err;
      }
    }
  }

  /** Simulate, then send and wait. Reverts are returned as data, not thrown. */
  private async write(functionName: string, args: readonly unknown[]): Promise<TxResult> {
    const call = { address: this.address, abi: REGISTRY_ABI, functionName: functionName as never, args: args as never, account: this.wallet.account };
    const at = lastBlock === undefined ? {} : { blockNumber: lastBlock };
    try {
      const sim = await withRetry(() => this.pub.simulateContract({ ...call, ...at }));
      const gas = await withRetry(() => this.pub.estimateContractGas({ ...call, ...at } as never));
      const hash = await this.send({ ...call, gas: (gas * 13n) / 10n });
      const receipt = await this.pub.waitForTransactionReceipt({ hash });
      if (lastBlock === undefined || receipt.blockNumber > lastBlock) lastBlock = receipt.blockNumber;
      if (receipt.status !== "success") return { accepted: false, reason: "TransactionReverted", txHash: hash };
      const batchId = typeof sim.result === "bigint" && functionName === "mintCredits" ? Number(sim.result) : undefined;
      return { accepted: true, txHash: hash, batchId };
    } catch (err) {
      const revert = err instanceof BaseError ? err.walk((e) => e instanceof ContractFunctionRevertedError) : null;
      if (revert instanceof ContractFunctionRevertedError && revert.data?.errorName) {
        const detail = revert.data.args?.length ? `(${revert.data.args.map(readable).join(",")})` : "";
        const reason = `${revert.data.errorName}${detail}`;
        // PROVE_REVERTS=true sends the blocked attempt anyway, so the explorer shows a FAILED
        // transaction: on-chain proof that the contract refused it (costs a little test ETH).
        if (process.env.PROVE_REVERTS === "true") return { accepted: false, reason, txHash: await this.sendFailing(functionName, args) };
        return { accepted: false, reason };
      }
      throw err; // network or configuration problem: surface it, don't disguise it as a rejection
    }
  }

  /**
   * Submits a call we already know reverts, so it is mined as a FAILED transaction. Best effort:
   * returns undefined instead of throwing, so proof-gathering can never break a run.
   * (A real network returns the hash; a local Hardhat node mines it but reports an error carrying the hash.)
   */
  private async sendFailing(functionName: string, args: readonly unknown[]): Promise<Hex | undefined> {
    try {
      const hash = await this.send({ address: this.address, abi: REGISTRY_ABI, functionName, args, gas: 300_000n });
      const receipt = await this.pub.waitForTransactionReceipt({ hash });
      if (lastBlock === undefined || receipt.blockNumber > lastBlock) lastBlock = receipt.blockNumber;
      return hash;
    } catch (err) {
      const withHash = err instanceof BaseError ? err.walk((e) => typeof (e as { data?: { txHash?: unknown } }).data?.txHash === "string") : null;
      return (withHash as { data?: { txHash?: Hex } } | null)?.data?.txHash;
    }
  }

  registerProject(p: { projectId: string; developer: string; hostCountry: string; boundaryHash: string; periodStart: number; periodEnd: number }) {
    return this.write("registerProject", [toBytes32(p.projectId), p.developer as Address, country(p.hostCountry), asHash(p.boundaryHash), BigInt(p.periodStart), BigInt(p.periodEnd)]);
  }
  submitAttestation(projectId: string, status: keyof typeof STATUS, attestedReduction: number, evidenceHash: string) {
    return this.write("submitAttestation", [toBytes32(projectId), STATUS[status], BigInt(attestedReduction), asHash(evidenceHash)]);
  }
  mintCredits(projectId: string, actor: string, quantity: number) {
    return this.write("mintCredits", [toBytes32(projectId), actor as Address, BigInt(quantity)]);
  }
  recordCorrespondingAdjustment(batchId: number, buyerCountry: string) {
    return this.write("recordCorrespondingAdjustment", [BigInt(batchId), country(buyerCountry)]);
  }
  transferCredits(batchId: number, actor: string, to: string, toCountry: string) {
    return this.write("transferCredits", [BigInt(batchId), actor as Address, to as Address, country(toCountry)]);
  }
  freezeCredits(batchId: number, reason: string) {
    return this.write("freezeCredits", [BigInt(batchId), reason]);
  }
  retireCredits(batchId: number, actor: string, beneficiary: string) {
    return this.write("retireCredits", [BigInt(batchId), actor as Address, beneficiary]);
  }
  anchorRun(runId: string, runHash: string) {
    return this.write("anchorRun", [toBytes32(runId), asHash(runHash)]);
  }
}

/** Builds the adapter for CHAIN_MODE=testnet (Base Sepolia) or CHAIN_MODE=local (Hardhat node). */
export function createViemAdapter(strict: boolean, opts: { local?: boolean } = {}): ViemAdapter {
  const local = opts.local ?? process.env.CHAIN_MODE === "local";
  const address = (strict ? process.env.REGISTRY_PROTECTED_ADDRESS : process.env.REGISTRY_UNPROTECTED_ADDRESS) as Address | undefined;
  // MetaMask exports keys without the 0x prefix; accept both.
  const rawKey = process.env.OPERATOR_PRIVATE_KEY?.trim();
  const privateKey = rawKey ? ((rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as Hex) : undefined;
  if (!address) throw new Error(`Set ${strict ? "REGISTRY_PROTECTED_ADDRESS" : "REGISTRY_UNPROTECTED_ADDRESS"} (printed by the deploy script)`);
  if (!privateKey) throw new Error("Set OPERATOR_PRIVATE_KEY (the testnet wallet that deployed the registries)");
  return new ViemAdapter(address, {
    rpcUrl: process.env.RPC_URL || (local ? "http://127.0.0.1:8545" : "https://sepolia.base.org"),
    privateKey,
    chain: local ? hardhat : baseSepolia,
  });
}

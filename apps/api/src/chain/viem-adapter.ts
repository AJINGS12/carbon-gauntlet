import {
  BaseError, ContractFunctionRevertedError, createPublicClient, createWalletClient, hexToString, http, keccak256, stringToHex, toHex,
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

export class ViemAdapter implements ChainAdapter {
  private readonly pub;
  private readonly wallet;

  constructor(private readonly address: Address, opts: { rpcUrl: string; privateKey: Hex; chain: Chain }) {
    const transport = http(opts.rpcUrl);
    this.pub = createPublicClient({ chain: opts.chain, transport });
    this.wallet = createWalletClient({ chain: opts.chain, transport, account: privateKeyToAccount(opts.privateKey) });
  }

  /** Simulate, then send and wait. Reverts are returned as data, not thrown. */
  private async write(functionName: string, args: readonly unknown[]): Promise<TxResult> {
    try {
      const sim = await this.pub.simulateContract({
        address: this.address, abi: REGISTRY_ABI, functionName: functionName as never, args: args as never, account: this.wallet.account,
      });
      const hash = await this.wallet.writeContract(sim.request as never);
      const receipt = await this.pub.waitForTransactionReceipt({ hash });
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
      const hash = await this.wallet.writeContract({ address: this.address, abi: REGISTRY_ABI, functionName: functionName as never, args: args as never, gas: 300_000n } as never);
      await this.pub.waitForTransactionReceipt({ hash });
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
export function createViemAdapter(strict: boolean): ViemAdapter {
  const local = process.env.CHAIN_MODE === "local";
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

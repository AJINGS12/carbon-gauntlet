import type { AgentAction } from "../types.js";

/**
 * The four market actors (spec section 8). Goals and capabilities are fixed; strategy is not:
 * each round the agent (Claude, or the scripted fallback) decides what to do next.
 *
 * `portfolio` = synthetic project submissions this actor has prepared (data/seed/projects.json).
 * Attackers know what is wrong with their own submissions (the seed's `planted` note); the
 * verifier never sees that note.
 */
export type ActionName = AgentAction["action"];

export interface Role {
  id: string;
  name: string;
  honest: boolean;
  country: string;            // ISO-style code used for cross-border accounting ("ZZ" = fictional Coal Nation)
  address: string;            // simulated on-chain identity; the backend relays its transactions
  goal: string;
  brief: string;              // persona and strategy guidance for the model
  portfolio: string[];
  actions: ActionName[];
}

export const ROLES: Role[] = [
  {
    id: "honest-dev",
    name: "Honest Developer",
    honest: true,
    country: "TR",
    address: "0x00000000000000000000000000000000000000a1",
    goal: "Earn revenue by getting your real projects verified and minting the credits they earn.",
    brief: "You run genuine projects. Register each of your prepared projects, then mint exactly what the verifier approved. You never cheat.",
    portfolio: ["forest-tr-001", "cookstove-ke-001", "forest-tr-005"],
    actions: ["REGISTER_PROJECT", "MINT_CREDITS", "RETIRE_CREDITS", "WAIT"],
  },
  {
    id: "opportunist-dev",
    name: "Opportunist Developer",
    honest: false,
    country: "TR",
    address: "0x00000000000000000000000000000000000000b2",
    goal: "Get as many credits minted as possible, by any means the registry fails to stop.",
    brief:
      "You cut corners. Your prepared submissions each have a weakness you know about. You can also clone another project's paperwork " +
      "onto a nearby plot (REGISTER_VARIANT). Read every rejection reason carefully and change tactics to get around the checks you hit.",
    portfolio: ["forest-tr-002", "cookstove-ke-004", "forest-br-004"],
    actions: ["REGISTER_PROJECT", "REGISTER_VARIANT", "MINT_CREDITS", "WAIT"],
  },
  {
    id: "broker",
    name: "Credit Broker",
    honest: false,
    country: "KE",
    address: "0x00000000000000000000000000000000000000c3",
    goal: "Maximise resale profit from credits, even if the same credits get sold or counted more than once.",
    brief:
      "You trade credits. You already own a batch. Profitable tricks include retiring a batch for one client and then selling it again, " +
      "selling across borders without the paperwork, and cloning a successful project in another country. Adapt when a trick is blocked.",
    portfolio: ["solar-br-005"],
    actions: ["REGISTER_PROJECT", "REGISTER_VARIANT", "MINT_CREDITS", "TRANSFER_CREDITS", "RETIRE_CREDITS", "WAIT"],
  },
  {
    id: "coal-nation",
    name: "Coal Nation",
    honest: false,
    country: "ZZ",
    address: "0x00000000000000000000000000000000000000d4",
    goal: "Meet your national emissions target as cheaply and quickly as possible by acquiring foreign credits.",
    brief:
      "You are a government. Buying foreign credits and counting them at home, while the host country also counts them, is cheapest. " +
      "A corresponding adjustment from the host country avoids double counting but costs time. Decide what is worth it.",
    portfolio: [],
    actions: ["BUY_CREDITS", "REQUEST_ADJUSTMENT", "RETIRE_CREDITS", "WAIT"],
  },
];

export const roleById = new Map(ROLES.map((r) => [r.id, r]));
export const ADDRESS: Record<string, string> = {
  ...Object.fromEntries(ROLES.map((r) => [r.id, r.address])),
  "green-coop": "0x00000000000000000000000000000000000000e5", // owner of the pre-seeded honest market
};

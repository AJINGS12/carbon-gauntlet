import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "dotenv/config";

const key = process.env.OPERATOR_PRIVATE_KEY;

const config: HardhatUserConfig = {
  solidity: "0.8.24",
  // Optional: verify the source on BaseScan so the explorer shows the code and decoded errors.
  // Needs a free Etherscan API key (ETHERSCAN_API_KEY in contracts/.env).
  etherscan: { apiKey: process.env.ETHERSCAN_API_KEY ?? "" },
  networks: {
    baseSepolia: {
      url: process.env.RPC_URL || "https://sepolia.base.org",
      accounts: key ? [key] : [],
    },
  },
};

export default config;

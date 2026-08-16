// Tempo chain constants and ABIs.
//
// Verified against primary sources in tempoxyz/tempo:
// - crates/contracts/src/precompiles/mod.rs   (precompile addresses, pathUSD)
// - crates/contracts/src/precompiles/account_keychain.rs (events, read functions)
// - crates/contracts/src/precompiles/tip20.rs (Transfer/TransferWithMemo events)
// - crates/chainspec/src/spec.rs (Moderato testnet = 42431, Presto mainnet = 4217)

import { parseAbi } from "viem";

/** AccountKeychain precompile — active since genesis on all Tempo networks (EIP-55 form). */
export const ACCOUNT_KEYCHAIN_ADDRESS =
  "0xaAAAaaAA00000000000000000000000000000000" as const;

/** pathUSD, the default fee token TIP-20, present from genesis. */
export const PATH_USD_ADDRESS =
  "0x20C0000000000000000000000000000000000000" as const;

/** Moderato (Tempo testnet). RPC follow URL in chainspec: wss://rpc.moderato.tempo.xyz */
export const MODERATO_CHAIN_ID = 42431;
export const MODERATO_RPC_URL = "https://rpc.moderato.tempo.xyz";

/** TIP-20 tokens use 6 decimal places (Tempo TIP-20 spec). */
export const TIP20_DECIMALS = 6;

export const keychainEventsAbi = parseAbi([
  "event KeyAuthorized(address indexed account, address indexed publicKey, uint8 signatureType, uint64 expiry)",
  "event KeyRevoked(address indexed account, address indexed publicKey)",
  "event SpendingLimitUpdated(address indexed account, address indexed publicKey, address indexed token, uint256 newLimit)",
  "event AccessKeySpend(address indexed account, address indexed publicKey, address indexed token, uint256 amount, uint256 remainingLimit)",
]);

export const tip20EventsAbi = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 amount)",
  "event TransferWithMemo(address indexed from, address indexed to, uint256 amount, bytes32 indexed memo)",
]);

export const keychainReadsAbi = parseAbi([
  "function getRemainingLimitWithPeriod(address account, address keyId, address token) view returns (uint256 remaining, uint64 periodEnd)",
]);

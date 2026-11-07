import { Keypair } from "@stellar/stellar-sdk";

const keypair = Keypair.random();

console.log("Disposable Stellar Testnet keypair (never use this key on mainnet):");
console.log(`STELLAR_PUBLIC_KEY=${keypair.publicKey()}`);
console.log(`STELLAR_SECRET_KEY=${keypair.secret()}`);
console.log(`Fund it: https://friendbot.stellar.org?addr=${keypair.publicKey()}`);

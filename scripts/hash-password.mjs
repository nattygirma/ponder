import { createPasswordHash } from "./password-hash.mjs";

const password = process.argv.slice(2).join(" ") || process.env.PONDER_PASSWORD;

if (!password) {
  console.error("Usage: bun run auth:hash -- <password>");
  console.error("Or: PONDER_PASSWORD=<password> bun run auth:hash");
  process.exit(1);
}

console.log(createPasswordHash(password));

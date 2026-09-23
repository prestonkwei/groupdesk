/*
 * Next loads .env.local automatically; plain node scripts do not. Import this
 * first in every CLI script so `pnpm db:migrate` and friends see the same
 * variables `pnpm dev` does.
 */
import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });

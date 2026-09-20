import { existsSync } from "node:fs";
import { defineConfig, env } from "@prisma/config";

// Vercel (and other hosts) inject env vars directly into process.env and
// don't ship a .env file — only load it when running locally.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // Session-mode pooler (port 5432) — the transaction-mode pooler in
    // DATABASE_URL cannot run the DDL that migrations and db push issue.
    url: env("DIRECT_URL"),
  },
});

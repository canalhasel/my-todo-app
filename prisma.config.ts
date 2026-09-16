import { defineConfig, env } from "@prisma/config";

process.loadEnvFile(".env");

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // Session-mode pooler (port 5432) — the transaction-mode pooler in
    // DATABASE_URL cannot run the DDL that migrations and db push issue.
    url: env("DIRECT_URL"),
  },
});

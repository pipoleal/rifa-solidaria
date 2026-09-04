import { execSync } from "node:child_process";
import { afterAll, beforeAll, beforeEach } from "vitest";

beforeAll(() => {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL não definida — copie apps/api/.env.test.example para .env.test " +
        "e suba `docker compose -f docker-compose.test.yml up -d` antes de rodar os testes de integração.",
    );
  }

  // Valida as migrations do jeito que rodariam em produção — `migrate deploy`,
  // não `migrate dev` (que usa um shadow database e não reflete o pipeline real).
  execSync("npx prisma migrate deploy", { stdio: "inherit" });
});

beforeEach(async () => {
  const { prisma } = await import("../lib/prisma.js");
  // RESTART IDENTITY CASCADE: reseta sequências e limpa as duas tabelas de
  // negócio (donations depende de campaigns via FK) entre cada teste.
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "donations", "campaigns" RESTART IDENTITY CASCADE',
  );
});

afterAll(async () => {
  const { prisma } = await import("../lib/prisma.js");
  await prisma.$disconnect();
});

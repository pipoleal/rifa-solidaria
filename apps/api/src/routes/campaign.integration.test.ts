import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/mercadopago.js", () => ({
  paymentClient: { create: vi.fn(), get: vi.fn() },
}));

const { buildApp } = await import("../app.js");
const { prisma } = await import("../lib/prisma.js");
const { DonationStatus } = await import("../generated/prisma/enums.js");

describe("[integração real] GET /api/campaign", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = buildApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("retorna 404 quando não há campanha ativa (tabela vazia de verdade)", async () => {
    const response = await app.inject({ method: "GET", url: "/api/campaign" });
    expect(response.statusCode).toBe(404);
  });

  it("soma só doações APPROVED via SUM real do Postgres (não via lógica em memória)", async () => {
    const campaign = await prisma.campaign.create({
      data: {
        title: "Campanha Real",
        slug: `campanha-${randomUUID()}`,
        story: "História de teste.",
        goalAmount: 100_000,
        isActive: true,
      },
    });

    await prisma.donation.createMany({
      data: [
        {
          campaignId: campaign.id,
          clientRequestId: randomUUID(),
          donorName: "A",
          donorEmail: "a@example.com",
          amount: 1000,
          status: DonationStatus.APPROVED,
          isPublic: false,
        },
        {
          campaignId: campaign.id,
          clientRequestId: randomUUID(),
          donorName: "B",
          donorEmail: "b@example.com",
          amount: 2500,
          status: DonationStatus.APPROVED,
          isPublic: false,
        },
        {
          campaignId: campaign.id,
          clientRequestId: randomUUID(),
          donorName: "C",
          donorEmail: "c@example.com",
          amount: 5000,
          status: DonationStatus.PENDING,
          isPublic: false,
        },
        {
          campaignId: campaign.id,
          clientRequestId: randomUUID(),
          donorName: "D",
          donorEmail: "d@example.com",
          amount: 9999,
          status: DonationStatus.REJECTED,
          isPublic: false,
        },
      ],
    });

    const response = await app.inject({ method: "GET", url: "/api/campaign" });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { currentAmount: number };
    expect(body.currentAmount).toBe(3500);
  });

  it("envia Cache-Control público de curta duração", async () => {
    await prisma.campaign.create({
      data: {
        title: "Campanha",
        slug: `campanha-${randomUUID()}`,
        story: "...",
        goalAmount: 100_000,
        isActive: true,
      },
    });

    const response = await app.inject({ method: "GET", url: "/api/campaign" });
    expect(response.headers["cache-control"]).toBe("public, max-age=30");
  });
});

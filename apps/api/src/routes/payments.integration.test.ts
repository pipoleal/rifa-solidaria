import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/mercadopago.js", () => ({
  paymentClient: { create: vi.fn(), get: vi.fn() },
}));

const { buildApp } = await import("../app.js");
const { prisma } = await import("../lib/prisma.js");
const { paymentClient } = await import("../lib/mercadopago.js");

describe("[integração real] POST /api/payments/create", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    vi.mocked(paymentClient.create).mockReset();
    vi.mocked(paymentClient.create).mockResolvedValue({
      id: 123456789,
      status: "pending",
      point_of_interaction: {
        transaction_data: {
          qr_code: "00020126-fake-copia-e-cola",
          qr_code_base64: "ZmFrZQ==",
          ticket_url: "https://www.mercadopago.com.br/payments/123456789/ticket",
        },
      },
      api_response: { status: 201, headers: ["", []] as [string, string[]] },
    });
    app = buildApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("cria a Donation de verdade no Postgres e retorna os dados do Pix", async () => {
    const campaign = await prisma.campaign.create({
      data: {
        title: "Campanha",
        slug: `campanha-${randomUUID()}`,
        story: "...",
        goalAmount: 100_000,
        isActive: true,
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/payments/create",
      payload: {
        clientRequestId: randomUUID(),
        campaignId: campaign.id,
        amount: 2500,
        donorName: "Maria da Silva",
        donorEmail: "maria@example.com",
        isPublic: false,
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as { donationId: string; qrCode: string };
    const stored = await prisma.donation.findUniqueOrThrow({ where: { id: body.donationId } });
    expect(stored.status).toBe("PENDING");
    expect(stored.mpPaymentId).toBe("123456789");
  });

  it("concorrência real: 10 requisições simultâneas com o mesmo clientRequestId criam só 1 linha (constraint UNIQUE real do Postgres, não simulada)", async () => {
    const campaign = await prisma.campaign.create({
      data: {
        title: "Campanha",
        slug: `campanha-${randomUUID()}`,
        story: "...",
        goalAmount: 100_000,
        isActive: true,
      },
    });
    const clientRequestId = randomUUID();
    const payload = {
      clientRequestId,
      campaignId: campaign.id,
      amount: 2500,
      donorName: "Maria",
      donorEmail: "maria@example.com",
      isPublic: false,
    };

    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        app.inject({ method: "POST", url: "/api/payments/create", payload }),
      ),
    );

    expect(responses.every((response) => response.statusCode === 201)).toBe(true);
    const donationIds = new Set(responses.map((response) => response.json().donationId));
    expect(donationIds.size).toBe(1);

    const count = await prisma.donation.count({ where: { clientRequestId } });
    expect(count).toBe(1);
  }, 15_000);

  it("404 real para campanha inexistente (sem seed nenhum)", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/payments/create",
      payload: {
        clientRequestId: randomUUID(),
        campaignId: randomUUID(),
        amount: 2500,
        donorName: "Maria",
        donorEmail: "maria@example.com",
        isPublic: false,
      },
    });

    expect(response.statusCode).toBe(404);
  });
});

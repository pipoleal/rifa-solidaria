import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/mercadopago.js", () => ({
  preferenceClient: { create: vi.fn() },
  paymentClient: { get: vi.fn() },
}));

const { buildApp } = await import("../app.js");
const { prisma } = await import("../lib/prisma.js");
const { paymentClient } = await import("../lib/mercadopago.js");
const { buildWebhookRequest } = await import("../test/mercadoPagoFixtures.js");

describe("[integração real] POST /api/webhooks/mercadopago", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const webhookSecret = process.env.MP_WEBHOOK_SECRET;

  beforeEach(async () => {
    if (!webhookSecret) {
      throw new Error("MP_WEBHOOK_SECRET não definida em .env.test");
    }
    vi.mocked(paymentClient.get).mockReset();
    app = buildApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  async function seedCampaignAndDonation() {
    const campaign = await prisma.campaign.create({
      data: {
        title: "Campanha",
        slug: `campanha-${randomUUID()}`,
        story: "...",
        goalAmount: 100_000,
        isActive: true,
      },
    });
    return prisma.donation.create({
      data: {
        campaignId: campaign.id,
        clientRequestId: randomUUID(),
        donorName: "Maria",
        donorEmail: "maria@example.com",
        amount: 2500,
        isPublic: false,
      },
    });
  }

  it("aprova a Donation de verdade (assinatura real, banco real)", async () => {
    const donation = await seedCampaignAndDonation();
    vi.mocked(paymentClient.get).mockResolvedValue({
      id: "555",
      status: "approved",
      status_detail: "accredited",
      external_reference: donation.id,
      transaction_amount: 25,
    } as never);

    const response = await app.inject(
      buildWebhookRequest(webhookSecret as string, "555", { requestId: randomUUID() }),
    );

    expect(response.statusCode).toBe(200);
    const stored = await prisma.donation.findUniqueOrThrow({ where: { id: donation.id } });
    expect(stored.status).toBe("APPROVED");
    expect(stored.mpPaymentId).toBe("555");
  });

  it("índice único parcial real: um payment_id não pode ficar associado a duas Donations", async () => {
    const donationA = await seedCampaignAndDonation();
    const donationB = await seedCampaignAndDonation();

    vi.mocked(paymentClient.get).mockResolvedValueOnce({
      id: "555",
      status: "approved",
      status_detail: "accredited",
      external_reference: donationA.id,
      transaction_amount: 25,
    } as never);
    const first = await app.inject(
      buildWebhookRequest(webhookSecret as string, "555", { requestId: randomUUID() }),
    );
    expect(first.statusCode).toBe(200);

    // Notificação inconsistente: mesmo payment_id "555", agora apontando
    // (via external_reference) para uma Donation diferente.
    vi.mocked(paymentClient.get).mockResolvedValueOnce({
      id: "555",
      status: "approved",
      status_detail: "accredited",
      external_reference: donationB.id,
      transaction_amount: 25,
    } as never);
    const second = await app.inject(
      buildWebhookRequest(webhookSecret as string, "555", { requestId: randomUUID() }),
    );

    // Não deve virar 500 — applyPaymentStatus precisa engolir a violação
    // real de UNIQUE constraint (P2010) e tratar como não aplicado.
    expect(second.statusCode).toBe(200);

    const refreshedA = await prisma.donation.findUniqueOrThrow({ where: { id: donationA.id } });
    const refreshedB = await prisma.donation.findUniqueOrThrow({ where: { id: donationB.id } });
    expect(refreshedA.status).toBe("APPROVED");
    expect(refreshedA.mpPaymentId).toBe("555");
    expect(refreshedB.status).toBe("PENDING");
    expect(refreshedB.mpPaymentId).toBeNull();
  }, 15_000);

  it("concorrência real: duas notificações simultâneas do mesmo pagamento não duplicam nem quebram", async () => {
    const donation = await seedCampaignAndDonation();
    vi.mocked(paymentClient.get).mockResolvedValue({
      id: "777",
      status: "approved",
      status_detail: "accredited",
      external_reference: donation.id,
      transaction_amount: 25,
    } as never);

    const requestOptions = { requestId: randomUUID() };
    const [a, b] = await Promise.all([
      app.inject(buildWebhookRequest(webhookSecret as string, "777", requestOptions)),
      app.inject(buildWebhookRequest(webhookSecret as string, "777", requestOptions)),
    ]);

    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    const stored = await prisma.donation.findUniqueOrThrow({ where: { id: donation.id } });
    expect(stored.status).toBe("APPROVED");
  }, 15_000);
});

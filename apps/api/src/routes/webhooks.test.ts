import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DonationStatus } from "../generated/prisma/enums.js";
import { isTransitionAllowed } from "../lib/donations.js";
import {
  buildPaymentFixture,
  buildWebhookRequest,
  signWebhookNotification,
} from "../test/mercadoPagoFixtures.js";
import type { createFakePrisma } from "../test/fakePrisma.js";

const WEBHOOK_SECRET = "test-webhook-secret";

vi.mock("../lib/prisma.js", async () => {
  const { createFakePrisma } = await import("../test/fakePrisma.js");
  const fake = createFakePrisma();
  return { prisma: fake.fakePrisma, __fake: fake };
});
vi.mock("../lib/mercadopago.js", () => ({
  preferenceClient: { create: vi.fn() },
  paymentClient: { get: vi.fn() },
}));

const { buildApp } = await import("../app.js");
const { paymentClient } = await import("../lib/mercadopago.js");
const { __fake: fake } = (await import("../lib/prisma.js")) as unknown as {
  __fake: ReturnType<typeof createFakePrisma>;
};

function request(dataId: string, options: Parameters<typeof buildWebhookRequest>[2] = {}) {
  return buildWebhookRequest(WEBHOOK_SECRET, dataId, options);
}

describe("isTransitionAllowed (máquina de estados)", () => {
  const all = [
    DonationStatus.PENDING,
    DonationStatus.APPROVED,
    DonationStatus.REJECTED,
    DonationStatus.CANCELLED,
    DonationStatus.REFUNDED,
  ];

  it("permite PENDING -> APPROVED/REJECTED/CANCELLED", () => {
    expect(isTransitionAllowed(DonationStatus.PENDING, DonationStatus.APPROVED)).toBe(true);
    expect(isTransitionAllowed(DonationStatus.PENDING, DonationStatus.REJECTED)).toBe(true);
    expect(isTransitionAllowed(DonationStatus.PENDING, DonationStatus.CANCELLED)).toBe(true);
  });

  it("permite APPROVED -> REFUNDED e só isso", () => {
    expect(isTransitionAllowed(DonationStatus.APPROVED, DonationStatus.REFUNDED)).toBe(true);
    for (const next of all) {
      if (next === DonationStatus.REFUNDED) continue;
      expect(isTransitionAllowed(DonationStatus.APPROVED, next)).toBe(false);
    }
  });

  it("nunca permite sair de um estado terminal (exceto APPROVED->REFUNDED)", () => {
    for (const current of [
      DonationStatus.REJECTED,
      DonationStatus.CANCELLED,
      DonationStatus.REFUNDED,
    ]) {
      for (const next of all) {
        expect(isTransitionAllowed(current, next)).toBe(false);
      }
    }
  });

  it("nunca permite voltar de APPROVED para PENDING", () => {
    expect(isTransitionAllowed(DonationStatus.APPROVED, DonationStatus.PENDING)).toBe(false);
  });
});

describe("signWebhookNotification (fixture) x WebhookSignatureValidator (SDK real)", () => {
  it("a assinatura sem x-request-id (campo removido do manifesto) também é aceita pelo SDK real", async () => {
    const { WebhookSignatureValidator } = await import("mercadopago");
    const { header } = signWebhookNotification(WEBHOOK_SECRET, "999999999", undefined);

    expect(() =>
      WebhookSignatureValidator.validate({
        xSignature: header,
        xRequestId: undefined,
        dataId: "999999999",
        secret: WEBHOOK_SECRET,
      }),
    ).not.toThrow();
  });
});

describe("POST /api/webhooks/mercadopago", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    fake.reset();
    vi.mocked(paymentClient.get).mockReset();
    app = buildApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  async function seedPendingDonation(overrides: { amount?: number } = {}) {
    const campaign = {
      id: randomUUID(),
      title: "Campanha",
      slug: "campanha",
      story: "...",
      goalAmount: 100_000,
      coverImageUrl: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    fake.seedCampaign(campaign);
    const donation = await fake.fakePrisma.donation.create({
      data: {
        campaignId: campaign.id,
        clientRequestId: randomUUID(),
        donorName: "Maria",
        donorEmail: "maria@example.com",
        amount: overrides.amount ?? 2500,
        isPublic: false,
      },
    });
    return donation;
  }

  it("assinatura válida + pagamento approved: transiciona PENDING -> APPROVED", async () => {
    const donation = await seedPendingDonation();
    vi.mocked(paymentClient.get).mockResolvedValue(
      buildPaymentFixture({ external_reference: donation.id }) as never,
    );

    const response = await app.inject(request("999999999"));

    expect(response.statusCode).toBe(200);
    expect(fake.getDonation(donation.id)?.status).toBe("APPROVED");
    expect(fake.getDonation(donation.id)?.mpPaymentId).toBe("999999999");
  });

  it("assinatura sem x-request-id: ainda válida (campo é removido do manifesto, não vira string vazia)", async () => {
    const donation = await seedPendingDonation();
    vi.mocked(paymentClient.get).mockResolvedValue(
      buildPaymentFixture({ external_reference: donation.id }) as never,
    );

    const response = await app.inject(request("999999999", { omitRequestIdHeader: true }));

    expect(response.statusCode).toBe(200);
    expect(fake.getDonation(donation.id)?.status).toBe("APPROVED");
  });

  it("assinatura ausente: 401 INVALID_SIGNATURE, nenhuma alteração", async () => {
    const donation = await seedPendingDonation();
    vi.mocked(paymentClient.get).mockResolvedValue(
      buildPaymentFixture({ external_reference: donation.id }) as never,
    );

    const response = await app.inject(request("999999999", { omitSignature: true }));

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("INVALID_SIGNATURE");
    expect(paymentClient.get).not.toHaveBeenCalled();
    expect(fake.getDonation(donation.id)?.status).toBe("PENDING");
  });

  it("assinatura inválida (hash errado): 401, nenhuma alteração", async () => {
    const donation = await seedPendingDonation();
    vi.mocked(paymentClient.get).mockResolvedValue(
      buildPaymentFixture({ external_reference: donation.id }) as never,
    );

    const response = await app.inject(request("999999999", { badSignature: true }));

    expect(response.statusCode).toBe(401);
    expect(paymentClient.get).not.toHaveBeenCalled();
  });

  it("type diferente de 'payment' é ignorado (200, sem consultar o MP)", async () => {
    const response = await app.inject(request("999999999", { type: "merchant_order" }));

    expect(response.statusCode).toBe(200);
    expect(paymentClient.get).not.toHaveBeenCalled();
  });

  it("external_reference sem Donation correspondente: 200, não quebra", async () => {
    vi.mocked(paymentClient.get).mockResolvedValue(
      buildPaymentFixture({ external_reference: randomUUID() }) as never,
    );

    const response = await app.inject(request("999999999"));

    expect(response.statusCode).toBe(200);
  });

  it("status 'in_mediation' não altera a Donation", async () => {
    const donation = await seedPendingDonation();
    vi.mocked(paymentClient.get).mockResolvedValue(
      buildPaymentFixture({ external_reference: donation.id, status: "in_mediation" }) as never,
    );

    const response = await app.inject(request("999999999"));

    expect(response.statusCode).toBe(200);
    expect(fake.getDonation(donation.id)?.status).toBe("PENDING");
  });

  it("idempotência: a mesma notificação (mesmo payment id) processada duas vezes não muda o resultado", async () => {
    const donation = await seedPendingDonation();
    vi.mocked(paymentClient.get).mockResolvedValue(
      buildPaymentFixture({ external_reference: donation.id }) as never,
    );

    const first = await app.inject(request("999999999"));
    const second = await app.inject(request("999999999"));

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(fake.getDonation(donation.id)?.status).toBe("APPROVED");
    expect(fake.getDonation(donation.id)?.mpPaymentId).toBe("999999999");
  });

  it("concorrência: duas notificações simultâneas do mesmo pagamento resultam em estado consistente", async () => {
    const donation = await seedPendingDonation();
    vi.mocked(paymentClient.get).mockResolvedValue(
      buildPaymentFixture({ external_reference: donation.id }) as never,
    );

    const [a, b] = await Promise.all([
      app.inject(request("999999999")),
      app.inject(request("999999999")),
    ]);

    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(fake.getDonation(donation.id)?.status).toBe("APPROVED");
  });

  it("fora de ordem: notificação 'pending' atrasada não reverte uma Donation já APPROVED", async () => {
    const donation = await seedPendingDonation();
    vi.mocked(paymentClient.get).mockResolvedValueOnce(
      buildPaymentFixture({ external_reference: donation.id, status: "approved" }) as never,
    );
    await app.inject(request("999999999"));
    expect(fake.getDonation(donation.id)?.status).toBe("APPROVED");

    vi.mocked(paymentClient.get).mockResolvedValueOnce(
      buildPaymentFixture({ external_reference: donation.id, status: "pending" }) as never,
    );
    const late = await app.inject(request("999999999"));

    expect(late.statusCode).toBe(200);
    expect(fake.getDonation(donation.id)?.status).toBe("APPROVED");
  });

  it("APPROVED -> REFUNDED é permitido", async () => {
    const donation = await seedPendingDonation();
    vi.mocked(paymentClient.get).mockResolvedValueOnce(
      buildPaymentFixture({ external_reference: donation.id, status: "approved" }) as never,
    );
    await app.inject(request("999999999"));

    vi.mocked(paymentClient.get).mockResolvedValueOnce(
      buildPaymentFixture({ external_reference: donation.id, status: "refunded" }) as never,
    );
    const response = await app.inject(request("999999999"));

    expect(response.statusCode).toBe(200);
    expect(fake.getDonation(donation.id)?.status).toBe("REFUNDED");
  });

  it("paymentId conflitante: um payment_id já usado por OUTRA Donation não é aceito (sem crash)", async () => {
    const donationA = await seedPendingDonation();
    const donationB = await seedPendingDonation();

    // payment 111: aprova a Donation A normalmente.
    vi.mocked(paymentClient.get).mockResolvedValueOnce(
      buildPaymentFixture({
        id: "111",
        external_reference: donationA.id,
        status: "approved",
      }) as never,
    );
    await app.inject(request("111"));
    expect(fake.getDonation(donationA.id)?.status).toBe("APPROVED");
    expect(fake.getDonation(donationA.id)?.mpPaymentId).toBe("111");

    // Notificação forjada/inconsistente: mesmo payment_id "111", mas agora
    // external_reference aponta para a Donation B.
    vi.mocked(paymentClient.get).mockResolvedValueOnce(
      buildPaymentFixture({
        id: "111",
        external_reference: donationB.id,
        status: "approved",
      }) as never,
    );
    const response = await app.inject(request("111"));

    // Não deve quebrar (500) nem "roubar" o payment_id da Donation A.
    expect(response.statusCode).toBe(200);
    expect(fake.getDonation(donationB.id)?.status).toBe("PENDING");
    expect(fake.getDonation(donationB.id)?.mpPaymentId).toBeNull();
    expect(fake.getDonation(donationA.id)?.status).toBe("APPROVED");
  });

  it("divergência de transaction_amount não bloqueia a atualização de status", async () => {
    const donation = await seedPendingDonation({ amount: 2500 });
    vi.mocked(paymentClient.get).mockResolvedValue(
      buildPaymentFixture({ external_reference: donation.id, transaction_amount: 999 }) as never,
    );

    const response = await app.inject(request("999999999"));

    expect(response.statusCode).toBe(200);
    expect(fake.getDonation(donation.id)?.status).toBe("APPROVED");
  });

  it("falha ao consultar o Mercado Pago: 500 genérico, sem alterar a Donation", async () => {
    const donation = await seedPendingDonation();
    vi.mocked(paymentClient.get).mockRejectedValue(new Error("network timeout"));

    const response = await app.inject(request("999999999"));

    expect(response.statusCode).toBe(500);
    expect(response.json().error.code).toBe("PAYMENT_LOOKUP_FAILED");
    expect(fake.getDonation(donation.id)?.status).toBe("PENDING");
  });

  it("corpo JSON malformado retorna 400, não 500", async () => {
    const { header } = signWebhookNotification(WEBHOOK_SECRET, "999999999", randomUUID());

    const response = await app.inject({
      method: "POST",
      url: "/api/webhooks/mercadopago?data.id=999999999&type=payment",
      headers: {
        "x-signature": header,
        "content-type": "application/json",
      },
      payload: "{ not valid json",
    });

    expect(response.statusCode).toBe(400);
  });

  it("rate limit: a 121ª requisição em menos de 1 minuto retorna 429", async () => {
    const donation = await seedPendingDonation();
    vi.mocked(paymentClient.get).mockResolvedValue(
      buildPaymentFixture({ external_reference: donation.id }) as never,
    );

    let last;
    for (let i = 0; i < 121; i += 1) {
      last = await app.inject(request("999999999"));
    }

    expect(last?.statusCode).toBe(429);
    expect(last?.json().error.code).toBe("RATE_LIMITED");
  }, 15_000);

  it("segurança: o webhook secret e o access token nunca aparecem na resposta", async () => {
    const donation = await seedPendingDonation();
    vi.mocked(paymentClient.get).mockResolvedValue(
      buildPaymentFixture({ external_reference: donation.id }) as never,
    );

    const response = await app.inject(request("999999999"));

    expect(response.body).not.toContain(WEBHOOK_SECRET);
    expect(response.body).not.toContain("TEST-fake-access-token-for-tests");
  });
});

import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { createFakePrisma } from "../test/fakePrisma.js";

vi.mock("../lib/prisma.js", async () => {
  const { createFakePrisma } = await import("../test/fakePrisma.js");
  const fake = createFakePrisma();
  return { prisma: fake.fakePrisma, __fake: fake };
});
vi.mock("../lib/mercadopago.js", () => ({
  paymentClient: { create: vi.fn(), get: vi.fn() },
}));

const { buildApp } = await import("../app.js");
const { paymentClient } = await import("../lib/mercadopago.js");
const { __fake: fake } = (await import("../lib/prisma.js")) as unknown as {
  __fake: ReturnType<typeof createFakePrisma>;
};

/**
 * Teste de fluxo ponta a ponta (mockado): reproduz, dentro de uma única
 * instância real do Fastify, a jornada completa do doador —
 * `GET /api/campaign` (o que a landing page busca) → `POST
 * /api/payments/create` (o que o formulário envia, usando os dados que
 * vieram da campanha) → `initPoint` retornado → webhook confirma o
 * pagamento → a mesma `GET /api/campaign` reflete o novo total.
 *
 * Só o Mercado Pago é mockado (não temos credenciais de sandbox); banco,
 * rotas e validação Zod são os reais. A parte "formulário" da jornada
 * (React) é coberta separadamente em apps/web/.../DonationForm.test.tsx.
 */
describe("Fluxo: campanha -> formulário -> pagamento -> webhook", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    fake.reset();
    vi.mocked(paymentClient.create).mockReset();
    vi.mocked(paymentClient.get).mockReset();
    app = buildApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("campanha ativa -> doação -> initPoint -> webhook aprova -> meta atualizada", async () => {
    const campaign = {
      id: randomUUID(),
      title: "Campanha da Atleta",
      slug: "campanha-da-atleta",
      story: "Ajude a atleta a chegar ao campeonato.",
      goalAmount: 100_000,
      coverImageUrl: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    fake.seedCampaign(campaign);

    // 1) A landing page busca a campanha.
    const campaignResponse = await app.inject({ method: "GET", url: "/api/campaign" });
    expect(campaignResponse.statusCode).toBe(200);
    const campaignBody = campaignResponse.json() as { id: string; currentAmount: number };
    expect(campaignBody.id).toBe(campaign.id);
    expect(campaignBody.currentAmount).toBe(0);

    // 2) O formulário envia a doação usando o campaignId acima.
    vi.mocked(paymentClient.create).mockResolvedValue({
      id: 999999999,
      status: "pending",
      point_of_interaction: {
        transaction_data: {
          qr_code: "00020126-fake-copia-e-cola",
          qr_code_base64: "ZmFrZQ==",
          ticket_url: "https://www.mercadopago.com.br/payments/999999999/ticket",
        },
      },
      api_response: { status: 201, headers: ["", []] as [string, string[]] },
    });
    const clientRequestId = randomUUID();
    const paymentResponse = await app.inject({
      method: "POST",
      url: "/api/payments/create",
      payload: {
        clientRequestId,
        campaignId: campaignBody.id,
        amount: 2500,
        donorName: "Maria da Silva",
        donorEmail: "maria@example.com",
        isPublic: false,
      },
    });
    expect(paymentResponse.statusCode).toBe(201);
    const { donationId, qrCode } = paymentResponse.json() as {
      donationId: string;
      qrCode: string;
    };
    expect(qrCode).toBe("00020126-fake-copia-e-cola");

    // 3) Antes da confirmação do MP, a meta ainda não mudou (só doações
    // APPROVED contam).
    const beforeWebhook = await app.inject({ method: "GET", url: "/api/campaign" });
    expect((beforeWebhook.json() as { currentAmount: number }).currentAmount).toBe(0);

    // 4) O Mercado Pago confirma o pagamento via webhook.
    vi.mocked(paymentClient.get).mockResolvedValue({
      id: "999999999",
      status: "approved",
      status_detail: "accredited",
      external_reference: donationId,
      transaction_amount: 25,
    } as never);

    const webhookSecret = process.env.MP_WEBHOOK_SECRET;
    if (!webhookSecret)
      throw new Error("fixture: MP_WEBHOOK_SECRET não definido no ambiente de teste");
    const { buildWebhookRequest } = await import("../test/mercadoPagoFixtures.js");
    const webhookResponse = await app.inject(
      buildWebhookRequest(webhookSecret, "999999999", { requestId: randomUUID() }),
    );
    expect(webhookResponse.statusCode).toBe(200);

    // 5) A meta agora reflete a doação aprovada.
    const afterWebhook = await app.inject({ method: "GET", url: "/api/campaign" });
    expect((afterWebhook.json() as { currentAmount: number }).currentAmount).toBe(2500);
    expect(fake.getDonation(donationId)?.status).toBe("APPROVED");
  });
});

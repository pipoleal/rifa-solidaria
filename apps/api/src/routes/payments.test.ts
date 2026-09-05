import { randomUUID } from "node:crypto";
import { createPaymentRequestSchema } from "@solidaria/shared";
import { MercadoPagoError } from "mercadopago";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { createFakePrisma } from "../test/fakePrisma.js";

// `vi.mock` é hoisted para o topo do arquivo pelo Vitest — não temos acesso a
// variáveis do escopo do módulo aqui, então a fake store é criada e mantida
// inteiramente dentro do factory (via import dinâmico) e exposta como um
// export extra (`__fake`) do próprio módulo mockado, para o corpo dos testes
// acessar através de um `import()` normal, depois do mock já registrado.
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

function activeCampaign(overrides: Partial<Parameters<typeof fake.seedCampaign>[0]> = {}) {
  return {
    id: randomUUID(),
    title: "Campanha da Atleta",
    slug: "campanha-da-atleta",
    story: "Ajude a atleta a chegar ao campeonato.",
    goalAmount: 500_000,
    coverImageUrl: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function fakePixPaymentResponse(overrides: { id?: number } & Record<string, unknown> = {}) {
  return {
    id: 987654321,
    status: "pending",
    point_of_interaction: {
      transaction_data: {
        qr_code: "00020126580014br.gov.bcb.pix-fake-copia-e-cola",
        qr_code_base64: "aWZha2VxcmNvZGU=",
        ticket_url: "https://www.mercadopago.com.br/payments/fake/ticket",
      },
    },
    api_response: { status: 201, headers: ["", []] as [string, string[]] },
    ...overrides,
  };
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    clientRequestId: randomUUID(),
    campaignId: randomUUID(),
    amount: 2500,
    donorName: "Maria da Silva",
    donorEmail: "maria@example.com",
    isPublic: false,
    ...overrides,
  };
}

describe("createPaymentRequestSchema (validação)", () => {
  it("aceita um payload válido e aplica isPublic=false por padrão quando omitido", () => {
    const { isPublic: _isPublic, ...withoutIsPublic } = validPayload();
    const result = createPaymentRequestSchema.safeParse(withoutIsPublic);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isPublic).toBe(false);
    }
  });

  it("rejeita amount decimal/float", () => {
    expect(createPaymentRequestSchema.safeParse(validPayload({ amount: 25.5 })).success).toBe(
      false,
    );
  });

  it("rejeita amount não positivo", () => {
    expect(createPaymentRequestSchema.safeParse(validPayload({ amount: 0 })).success).toBe(false);
    expect(createPaymentRequestSchema.safeParse(validPayload({ amount: -100 })).success).toBe(
      false,
    );
  });

  it("rejeita amount abaixo do mínimo documentado", () => {
    expect(createPaymentRequestSchema.safeParse(validPayload({ amount: 100 })).success).toBe(false);
  });

  it("rejeita amount acima do máximo documentado", () => {
    expect(
      createPaymentRequestSchema.safeParse(validPayload({ amount: 999_999_999 })).success,
    ).toBe(false);
  });

  it("rejeita clientRequestId que não é UUID", () => {
    expect(
      createPaymentRequestSchema.safeParse(validPayload({ clientRequestId: "não-é-uuid" })).success,
    ).toBe(false);
  });

  it("rejeita campaignId que não é UUID", () => {
    expect(createPaymentRequestSchema.safeParse(validPayload({ campaignId: "123" })).success).toBe(
      false,
    );
  });

  it("rejeita donorEmail inválido", () => {
    expect(
      createPaymentRequestSchema.safeParse(validPayload({ donorEmail: "não-é-email" })).success,
    ).toBe(false);
  });

  it("normaliza donorEmail (trim + minúsculas)", () => {
    const result = createPaymentRequestSchema.safeParse(
      validPayload({ donorEmail: "  Maria@Example.COM  " }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.donorEmail).toBe("maria@example.com");
    }
  });

  it("rejeita donorName vazio/curto demais", () => {
    expect(createPaymentRequestSchema.safeParse(validPayload({ donorName: "A" })).success).toBe(
      false,
    );
  });

  it("nunca aceita um campo status vindo do cliente (é descartado silenciosamente)", () => {
    const result = createPaymentRequestSchema.safeParse(
      validPayload({ status: "APPROVED" } as unknown as Record<string, unknown>),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("status");
    }
  });
});

describe("POST /api/payments/create", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    fake.reset();
    vi.mocked(paymentClient.create).mockReset();
    vi.mocked(paymentClient.get).mockReset();
    vi.mocked(paymentClient.create).mockResolvedValue(fakePixPaymentResponse());

    app = buildApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("cria a doação e retorna donationId + dados do Pix (campanha ativa)", async () => {
    const campaign = activeCampaign();
    fake.seedCampaign(campaign);

    const response = await app.inject({
      method: "POST",
      url: "/api/payments/create",
      payload: validPayload({ campaignId: campaign.id }),
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.donationId).toBeTruthy();
    expect(body.qrCode).toBe("00020126580014br.gov.bcb.pix-fake-copia-e-cola");
    expect(body.qrCodeBase64).toBe("aWZha2VxcmNvZGU=");
    expect(fake.countDonations()).toBe(1);
  });

  it("retorna 404 CAMPAIGN_NOT_FOUND para campanha inexistente", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/payments/create",
      payload: validPayload({ campaignId: randomUUID() }),
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("CAMPAIGN_NOT_FOUND");
  });

  it("retorna 404 CAMPAIGN_NOT_FOUND (mesmo código) para campanha inativa", async () => {
    const campaign = activeCampaign({ isActive: false });
    fake.seedCampaign(campaign);

    const response = await app.inject({
      method: "POST",
      url: "/api/payments/create",
      payload: validPayload({ campaignId: campaign.id }),
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("CAMPAIGN_NOT_FOUND");
  });

  it("idempotência: o mesmo clientRequestId enviado duas vezes cria só 1 Donation", async () => {
    const campaign = activeCampaign();
    fake.seedCampaign(campaign);
    const payload = validPayload({ campaignId: campaign.id });
    vi.mocked(paymentClient.get).mockResolvedValue(fakePixPaymentResponse());

    const first = await app.inject({ method: "POST", url: "/api/payments/create", payload });
    const second = await app.inject({ method: "POST", url: "/api/payments/create", payload });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(first.json().donationId).toBe(second.json().donationId);
    expect(fake.countDonations()).toBe(1);
  });

  it("concorrência: duas requisições simultâneas com o mesmo clientRequestId criam só 1 Donation", async () => {
    const campaign = activeCampaign();
    fake.seedCampaign(campaign);
    const payload = validPayload({ campaignId: campaign.id });
    vi.mocked(paymentClient.get).mockResolvedValue(fakePixPaymentResponse());

    const [first, second] = await Promise.all([
      app.inject({ method: "POST", url: "/api/payments/create", payload }),
      app.inject({ method: "POST", url: "/api/payments/create", payload }),
    ]);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(first.json().donationId).toBe(second.json().donationId);
    expect(fake.countDonations()).toBe(1);
  });

  it("chama o Mercado Pago com payment_method_id=pix, amount convertido, payer e notification_url corretos, e salva mpPaymentId", async () => {
    const campaign = activeCampaign();
    fake.seedCampaign(campaign);

    const response = await app.inject({
      method: "POST",
      url: "/api/payments/create",
      payload: validPayload({ campaignId: campaign.id, amount: 2500 }),
    });

    const donationId = response.json().donationId as string;

    expect(paymentClient.create).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(paymentClient.create).mock.calls[0]?.[0] as {
      body: {
        external_reference?: string;
        notification_url?: string;
        payment_method_id?: string;
        transaction_amount?: number;
        payer?: { email?: string; first_name?: string; last_name?: string };
      };
      requestOptions?: { idempotencyKey?: string };
    };
    expect(callArgs.body.external_reference).toBe(donationId);
    expect(callArgs.body.notification_url).toBe("http://localhost:3333/api/webhooks/mercadopago");
    expect(callArgs.body.payment_method_id).toBe("pix");
    expect(callArgs.body.transaction_amount).toBe(25);
    expect(callArgs.body.payer).toEqual({
      email: "maria@example.com",
      first_name: "Maria",
      last_name: "da Silva",
    });
    expect(callArgs.requestOptions?.idempotencyKey).toBe(donationId);

    const stored = fake.getDonation(donationId);
    expect(stored?.mpPaymentId).toBe("987654321");
  });

  it("reutilização: reenviar o mesmo clientRequestId depois de já ter pagamento reconsulta em vez de criar outro", async () => {
    const campaign = activeCampaign();
    fake.seedCampaign(campaign);
    const payload = validPayload({ campaignId: campaign.id });
    vi.mocked(paymentClient.get).mockResolvedValue(fakePixPaymentResponse());

    await app.inject({ method: "POST", url: "/api/payments/create", payload });
    const response = await app.inject({ method: "POST", url: "/api/payments/create", payload });

    expect(response.statusCode).toBe(201);
    expect(paymentClient.create).toHaveBeenCalledTimes(1);
    expect(paymentClient.get).toHaveBeenCalledTimes(1);
  });

  it("situação terminal: Donation já concluída retorna 409 e não cria nova cobrança", async () => {
    const campaign = activeCampaign();
    fake.seedCampaign(campaign);
    const payload = validPayload({ campaignId: campaign.id });

    const created = await app.inject({ method: "POST", url: "/api/payments/create", payload });
    const donationId = created.json().donationId as string;
    const donation = fake.getDonation(donationId);
    if (!donation) throw new Error("fixture inconsistente");
    donation.status = "APPROVED" as never;

    const response = await app.inject({ method: "POST", url: "/api/payments/create", payload });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("DONATION_ALREADY_FINALIZED");
    expect(paymentClient.create).toHaveBeenCalledTimes(1); // só a 1ª chamada, antes do status terminal
  });

  it("falha do Mercado Pago: Donation continua PENDING e resposta é genérica (502 PAYMENT_PROVIDER_ERROR)", async () => {
    const campaign = activeCampaign();
    fake.seedCampaign(campaign);
    vi.mocked(paymentClient.create).mockRejectedValueOnce(
      new MercadoPagoError({ status: 500, message: "internal error", error: "server_error" }),
    );
    const payload = validPayload({ campaignId: campaign.id });

    const response = await app.inject({
      method: "POST",
      url: "/api/payments/create",
      payload,
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({
      error: {
        code: "PAYMENT_PROVIDER_ERROR",
        message: "Não foi possível iniciar o pagamento. Tente novamente.",
      },
    });

    expect(fake.countDonations()).toBe(1);
    const stored = fake.getDonationByClientRequestId(payload.clientRequestId);
    expect(stored?.status).toBe("PENDING");
    expect(stored?.mpPaymentId).toBeNull();
  });

  it("segurança: o Access Token nunca aparece em nenhuma resposta", async () => {
    const campaign = activeCampaign();
    fake.seedCampaign(campaign);

    const ok = await app.inject({
      method: "POST",
      url: "/api/payments/create",
      payload: validPayload({ campaignId: campaign.id }),
    });
    expect(ok.body).not.toContain("TEST-fake-access-token-for-tests");

    vi.mocked(paymentClient.create).mockRejectedValueOnce(
      new MercadoPagoError({ status: 401, message: "invalid token", error: "unauthorized" }),
    );
    const failed = await app.inject({
      method: "POST",
      url: "/api/payments/create",
      payload: validPayload({ campaignId: campaign.id }),
    });
    expect(failed.body).not.toContain("TEST-fake-access-token-for-tests");
    expect(failed.body).not.toContain("invalid token");
  });

  it("rate limit: a 6ª requisição em menos de 1 minuto retorna 429", async () => {
    const campaign = activeCampaign();
    fake.seedCampaign(campaign);

    const responses = [];
    for (let i = 0; i < 6; i += 1) {
      responses.push(
        await app.inject({
          method: "POST",
          url: "/api/payments/create",
          payload: validPayload({ campaignId: campaign.id }),
        }),
      );
    }

    const statusCodes = responses.map((r) => r.statusCode);
    expect(statusCodes.slice(0, 5).every((code) => code === 201)).toBe(true);
    expect(statusCodes[5]).toBe(429);
    expect(responses[5]?.json().error.code).toBe("RATE_LIMITED");
  });
});

describe("GET /api/donations/:id/status", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    fake.reset();
    app = buildApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("retorna o status atual da doação", async () => {
    const campaign = activeCampaign();
    fake.seedCampaign(campaign);
    const created = await app.inject({
      method: "POST",
      url: "/api/payments/create",
      payload: validPayload({ campaignId: campaign.id }),
    });
    const donationId = created.json().donationId as string;

    const response = await app.inject({ method: "GET", url: `/api/donations/${donationId}/status` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "PENDING" });
  });

  it("retorna 404 para doação inexistente", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/donations/${randomUUID()}/status`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("DONATION_NOT_FOUND");
  });

  it("retorna 400 para id que não é UUID", async () => {
    const response = await app.inject({ method: "GET", url: "/api/donations/not-a-uuid/status" });

    expect(response.statusCode).toBe(400);
  });
});

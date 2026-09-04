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
  preferenceClient: { create: vi.fn() },
}));

const { buildApp } = await import("../app.js");
const { preferenceClient } = await import("../lib/mercadopago.js");
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

function fakePreferenceResponse(overrides: { id?: string; init_point?: string } = {}) {
  return {
    id: "fake-preference-id",
    init_point: "https://sandbox.mercadopago.com/checkout/fake",
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
    vi.mocked(preferenceClient.create).mockReset();
    vi.mocked(preferenceClient.create).mockResolvedValue(fakePreferenceResponse());

    app = buildApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("cria a doação e retorna donationId + initPoint (campanha ativa)", async () => {
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
    expect(body.initPoint).toBe("https://sandbox.mercadopago.com/checkout/fake");
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

    const [first, second] = await Promise.all([
      app.inject({ method: "POST", url: "/api/payments/create", payload }),
      app.inject({ method: "POST", url: "/api/payments/create", payload }),
    ]);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(first.json().donationId).toBe(second.json().donationId);
    expect(fake.countDonations()).toBe(1);
  });

  it("chama o Mercado Pago com external_reference, amount convertido e notification_url corretos, e salva mpPreferenceId/mpInitPoint", async () => {
    const campaign = activeCampaign();
    fake.seedCampaign(campaign);

    const response = await app.inject({
      method: "POST",
      url: "/api/payments/create",
      payload: validPayload({ campaignId: campaign.id, amount: 2500 }),
    });

    const donationId = response.json().donationId as string;

    expect(preferenceClient.create).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(preferenceClient.create).mock.calls[0]?.[0] as {
      body: {
        external_reference?: string;
        notification_url?: string;
        back_urls?: { success?: string; pending?: string; failure?: string };
        auto_return?: string;
        items: Array<{ unit_price: number; currency_id?: string }>;
      };
    };
    expect(callArgs.body.external_reference).toBe(donationId);
    expect(callArgs.body.notification_url).toBe("http://localhost:3333/api/webhooks/mercadopago");
    expect(callArgs.body.items[0]?.unit_price).toBe(25);
    expect(callArgs.body.items[0]?.currency_id).toBe("BRL");
    expect(callArgs.body.auto_return).toBe("approved");
    expect(callArgs.body.back_urls).toEqual({
      success: "http://localhost:3000/doacao/sucesso",
      pending: "http://localhost:3000/doacao/pendente",
      failure: "http://localhost:3000/doacao/erro",
    });

    const stored = fake.getDonation(donationId);
    expect(stored?.mpPreferenceId).toBe("fake-preference-id");
    expect(stored?.mpInitPoint).toBe("https://sandbox.mercadopago.com/checkout/fake");
  });

  it("reutilização: reenviar o mesmo clientRequestId depois de já ter preference não chama o Mercado Pago de novo", async () => {
    const campaign = activeCampaign();
    fake.seedCampaign(campaign);
    const payload = validPayload({ campaignId: campaign.id });

    await app.inject({ method: "POST", url: "/api/payments/create", payload });
    const response = await app.inject({ method: "POST", url: "/api/payments/create", payload });

    expect(response.statusCode).toBe(201);
    expect(preferenceClient.create).toHaveBeenCalledTimes(1);
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
    expect(preferenceClient.create).toHaveBeenCalledTimes(1); // só a 1ª chamada, antes do status terminal
  });

  it("falha do Mercado Pago: Donation continua PENDING e resposta é genérica (502 PAYMENT_PROVIDER_ERROR)", async () => {
    const campaign = activeCampaign();
    fake.seedCampaign(campaign);
    vi.mocked(preferenceClient.create).mockRejectedValueOnce(
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
    expect(stored?.mpPreferenceId).toBeNull();
    expect(stored?.mpInitPoint).toBeNull();
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

    vi.mocked(preferenceClient.create).mockRejectedValueOnce(
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

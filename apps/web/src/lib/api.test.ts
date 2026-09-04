import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, createPayment, getCampaign } from "./api";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const validCampaign = {
  id: "123e4567-e89b-12d3-a456-426614174000",
  title: "Campanha",
  slug: "campanha",
  story: "...",
  goalAmount: 100_000,
  currentAmount: 25_00,
  coverImageUrl: null,
};

const validPaymentInput = {
  clientRequestId: "123e4567-e89b-12d3-a456-426614174000",
  campaignId: "123e4567-e89b-12d3-a456-426614174000",
  amount: 2500,
  donorName: "Maria",
  donorEmail: "maria@example.com",
  isPublic: false,
};

describe("getCampaign", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retorna a campanha quando a API responde 200 com um payload válido", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, validCampaign));
    const campaign = await getCampaign();
    expect(campaign?.id).toBe(validCampaign.id);
  });

  it("retorna null quando a API responde 404", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(404, { error: { code: "x", message: "x" } }));
    const campaign = await getCampaign();
    expect(campaign).toBeNull();
  });

  it("lança ApiError para outros erros", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(500, {}));
    await expect(getCampaign()).rejects.toBeInstanceOf(ApiError);
  });
});

describe("createPayment", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retorna donationId e initPoint em caso de sucesso", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(201, {
        donationId: "123e4567-e89b-12d3-a456-426614174000",
        initPoint: "https://mercadopago.com/checkout/abc",
      }),
    );

    const result = await createPayment(validPaymentInput);
    expect(result.initPoint).toBe("https://mercadopago.com/checkout/abc");
  });

  it("envia o body serializado corretamente", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(201, {
        donationId: "123e4567-e89b-12d3-a456-426614174000",
        initPoint: "https://mercadopago.com/checkout/abc",
      }),
    );

    await createPayment(validPaymentInput);

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3333/api/payments/create");
    expect(JSON.parse(init.body as string)).toMatchObject({
      clientRequestId: validPaymentInput.clientRequestId,
      amount: 2500,
    });
  });

  it("lança ApiError com o code retornado pela API em caso de erro conhecido", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(409, {
        error: { code: "DONATION_ALREADY_FINALIZED", message: "Já concluída." },
      }),
    );

    await expect(createPayment(validPaymentInput)).rejects.toMatchObject({
      code: "DONATION_ALREADY_FINALIZED",
    });
  });

  it("lança ApiError genérico quando a resposta de erro não tem o formato esperado", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("not json", { status: 500 }));
    await expect(createPayment(validPaymentInput)).rejects.toBeInstanceOf(ApiError);
  });
});

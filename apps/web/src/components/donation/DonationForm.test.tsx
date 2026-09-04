import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { DonationForm } from "./DonationForm";

const { createPaymentMock } = vi.hoisted(() => ({ createPaymentMock: vi.fn() }));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, createPayment: createPaymentMock };
});

const CAMPAIGN_ID = "123e4567-e89b-12d3-a456-426614174000";

async function fillValidForm() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Nome"), "Maria da Silva");
  await user.type(screen.getByLabelText("E-mail"), "maria@example.com");
  return user;
}

describe("DonationForm", () => {
  beforeEach(() => {
    createPaymentMock.mockReset();
    Object.defineProperty(window, "location", {
      writable: true,
      value: { href: "" },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("começa com R$25 pré-selecionado e o botão habilitado quando os dados são inválidos", () => {
    render(<DonationForm campaignId={CAMPAIGN_ID} />);
    expect(screen.getByRole("button", { name: /R\$\s*25,00/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "QUERO AJUDAR" })).toBeDisabled();
  });

  it("não tem violações de acessibilidade detectáveis automaticamente (axe)", async () => {
    const { container } = render(<DonationForm campaignId={CAMPAIGN_ID} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("também não tem violações com 'Outro valor' selecionado (campo extra visível)", async () => {
    const user = userEvent.setup();
    const { container } = render(<DonationForm campaignId={CAMPAIGN_ID} />);
    await user.click(screen.getByRole("button", { name: "Outro valor" }));

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("habilita o botão só quando nome, e-mail e valor são válidos", async () => {
    render(<DonationForm campaignId={CAMPAIGN_ID} />);
    await fillValidForm();
    expect(screen.getByRole("button", { name: "QUERO AJUDAR" })).toBeEnabled();
  });

  it("permite trocar para 'Outro valor' e valida o intervalo (UX)", async () => {
    const user = userEvent.setup();
    render(<DonationForm campaignId={CAMPAIGN_ID} />);
    await user.click(screen.getByRole("button", { name: "Outro valor" }));

    const customInput = screen.getByLabelText("Valor em reais");
    await user.type(customInput, "1");
    expect(screen.getByText(/O valor deve estar entre/)).toBeInTheDocument();

    await user.clear(customInput);
    await user.type(customInput, "30");
    expect(screen.queryByText(/O valor deve estar entre/)).not.toBeInTheDocument();
  });

  it("ao enviar com sucesso, chama createPayment e redireciona para o initPoint", async () => {
    createPaymentMock.mockResolvedValue({
      donationId: "d1",
      initPoint: "https://mercadopago.com/checkout/abc",
    });
    render(<DonationForm campaignId={CAMPAIGN_ID} />);
    const user = await fillValidForm();
    await user.click(screen.getByRole("button", { name: "QUERO AJUDAR" }));

    await waitFor(() => {
      expect(window.location.href).toBe("https://mercadopago.com/checkout/abc");
    });
    expect(createPaymentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: CAMPAIGN_ID,
        amount: 2500,
        donorName: "Maria da Silva",
        donorEmail: "maria@example.com",
        isPublic: false,
      }),
    );
  });

  it("desabilita o botão e mostra 'Enviando...' durante o envio", async () => {
    let resolveSubmit: (value: { donationId: string; initPoint: string }) => void = () => {
      throw new Error("not set");
    };
    createPaymentMock.mockReturnValue(
      new Promise((resolve) => {
        resolveSubmit = resolve;
      }),
    );

    render(<DonationForm campaignId={CAMPAIGN_ID} />);
    const user = await fillValidForm();
    await user.click(screen.getByRole("button", { name: "QUERO AJUDAR" }));

    const button = screen.getByRole("button", { name: "Enviando..." });
    expect(button).toBeDisabled();

    resolveSubmit({ donationId: "d1", initPoint: "https://mercadopago.com/checkout/abc" });
    await waitFor(() => {
      expect(window.location.href).toBe("https://mercadopago.com/checkout/abc");
    });
  });

  it("mostra mensagem amigável de rate limit (429) e permite tentar de novo", async () => {
    createPaymentMock.mockRejectedValue(new ApiError("RATE_LIMITED", "detalhe interno", 429));
    render(<DonationForm campaignId={CAMPAIGN_ID} />);
    const user = await fillValidForm();
    await user.click(screen.getByRole("button", { name: "QUERO AJUDAR" }));

    expect(
      await screen.findByText(
        "Muitas tentativas em pouco tempo. Aguarde um instante e tente de novo.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "QUERO AJUDAR" })).toBeEnabled();
  });

  it("mostra mensagem amigável e reabilita o botão quando a API retorna erro conhecido", async () => {
    createPaymentMock.mockRejectedValue(
      new ApiError("PAYMENT_PROVIDER_ERROR", "detalhe interno", 502),
    );
    render(<DonationForm campaignId={CAMPAIGN_ID} />);
    const user = await fillValidForm();
    await user.click(screen.getByRole("button", { name: "QUERO AJUDAR" }));

    expect(
      await screen.findByText(
        "Não foi possível iniciar o pagamento agora. Tente novamente em instantes.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "QUERO AJUDAR" })).toBeEnabled();
    expect(screen.queryByText("detalhe interno")).not.toBeInTheDocument();
  });

  it("mostra mensagem de rede quando createPayment lança um erro que não é ApiError", async () => {
    createPaymentMock.mockRejectedValue(new TypeError("failed to fetch"));
    render(<DonationForm campaignId={CAMPAIGN_ID} />);
    const user = await fillValidForm();
    await user.click(screen.getByRole("button", { name: "QUERO AJUDAR" }));

    expect(await screen.findByText(/Não foi possível conectar ao servidor/)).toBeInTheDocument();
  });

  it("reenvia com o mesmo clientRequestId em uma nova tentativa após erro", async () => {
    createPaymentMock.mockRejectedValueOnce(new ApiError("PAYMENT_PROVIDER_ERROR", "x", 502));
    createPaymentMock.mockResolvedValueOnce({
      donationId: "d1",
      initPoint: "https://mercadopago.com/checkout/abc",
    });

    render(<DonationForm campaignId={CAMPAIGN_ID} />);
    const user = await fillValidForm();
    const submitButton = screen.getByRole("button", { name: "QUERO AJUDAR" });

    await user.click(submitButton);
    await screen.findByRole("alert");
    await user.click(submitButton);

    await waitFor(() => {
      expect(window.location.href).toBe("https://mercadopago.com/checkout/abc");
    });

    const firstCallId = (createPaymentMock.mock.calls[0]?.[0] as { clientRequestId: string })
      .clientRequestId;
    const secondCallId = (createPaymentMock.mock.calls[1]?.[0] as { clientRequestId: string })
      .clientRequestId;
    expect(firstCallId).toBe(secondCallId);
  });
});

import {
  apiErrorResponseSchema,
  campaignResponseSchema,
  createPaymentRequestSchema,
  createPaymentResponseSchema,
  donationStatusResponseSchema,
  type CampaignResponse,
  type CreatePaymentRequest,
  type CreatePaymentResponse,
  type DonationStatusResponse,
} from "@solidaria/shared";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

function apiUrl(path: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!baseUrl) {
    throw new Error("NEXT_PUBLIC_API_URL não está definida.");
  }
  return `${baseUrl}${path}`;
}

/** Busca a campanha ativa. Retorna `null` quando não há campanha ativa (404). */
export async function getCampaign(): Promise<CampaignResponse | null> {
  const response = await fetch(apiUrl("/api/campaign"), { cache: "no-store" });

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new ApiError("UNKNOWN_ERROR", "Não foi possível carregar a campanha.", response.status);
  }

  const data: unknown = await response.json();
  return campaignResponseSchema.parse(data);
}

export async function createPayment(input: CreatePaymentRequest): Promise<CreatePaymentResponse> {
  const body = createPaymentRequestSchema.parse(input);

  const response = await fetch(apiUrl("/api/payments/create"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const parsedError = apiErrorResponseSchema.safeParse(data);
    if (parsedError.success) {
      throw new ApiError(
        parsedError.data.error.code,
        parsedError.data.error.message,
        response.status,
      );
    }
    throw new ApiError("UNKNOWN_ERROR", "Erro inesperado ao criar o pagamento.", response.status);
  }

  return createPaymentResponseSchema.parse(data);
}

export async function getDonationStatus(donationId: string): Promise<DonationStatusResponse> {
  const response = await fetch(apiUrl(`/api/donations/${donationId}/status`));

  const data: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const parsedError = apiErrorResponseSchema.safeParse(data);
    if (parsedError.success) {
      throw new ApiError(
        parsedError.data.error.code,
        parsedError.data.error.message,
        response.status,
      );
    }
    throw new ApiError("UNKNOWN_ERROR", "Erro inesperado ao consultar a doação.", response.status);
  }

  return donationStatusResponseSchema.parse(data);
}

import { ApiError } from "./api";

const MESSAGES_BY_CODE: Record<string, string> = {
  VALIDATION_ERROR: "Verifique os dados informados e tente novamente.",
  CAMPAIGN_NOT_FOUND: "Esta campanha não está mais disponível.",
  DONATION_ALREADY_FINALIZED: "Esta doação já foi concluída.",
  RATE_LIMITED: "Muitas tentativas em pouco tempo. Aguarde um instante e tente de novo.",
  PAYMENT_PROVIDER_ERROR:
    "Não foi possível iniciar o pagamento agora. Tente novamente em instantes.",
};

const DEFAULT_MESSAGE = "Algo deu errado. Tente novamente em instantes.";
const NETWORK_MESSAGE =
  "Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.";

/** Traduz um erro da API (ou de rede) para uma mensagem amigável ao doador. */
export function friendlyErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return MESSAGES_BY_CODE[error.code] ?? DEFAULT_MESSAGE;
  }
  return NETWORK_MESSAGE;
}

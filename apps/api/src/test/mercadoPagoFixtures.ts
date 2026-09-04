import { createHmac, randomUUID } from "node:crypto";

/**
 * Constrói o manifesto e o header `x-signature` exatamente como o
 * `WebhookSignatureValidator` do SDK oficial espera — confirmado por
 * round-trip real nos testes (assinamos aqui, o SDK real valida).
 *
 * `requestId: undefined` simula o caso documentado em que o Mercado Pago
 * não envia `x-request-id`: o campo correspondente é removido do manifesto,
 * não substituído por uma string vazia.
 */
export function signWebhookNotification(
  secret: string,
  dataId: string,
  requestId: string | undefined,
  ts = Math.floor(Date.now() / 1000).toString(),
): { header: string; manifest: string } {
  const manifest = `id:${dataId.toLowerCase()};${requestId ? `request-id:${requestId};` : ""}ts:${ts};`;
  const hash = createHmac("sha256", secret).update(manifest).digest("hex");
  return { header: `ts=${ts},v1=${hash}`, manifest };
}

export type WebhookRequestOptions = {
  requestId?: string;
  omitRequestIdHeader?: boolean;
  badSignature?: boolean;
  omitSignature?: boolean;
  type?: string;
};

/**
 * Monta uma requisição de notificação do Mercado Pago pronta para
 * `app.inject()`, cobrindo os cenários documentados: assinatura válida,
 * inválida, ausente, e `x-request-id` ausente.
 */
export function buildWebhookRequest(
  secret: string,
  dataId: string,
  options: WebhookRequestOptions = {},
) {
  // Sempre gera um requestId "real" para assinar quando não omitido — o MP
  // sempre envia x-request-id na prática; `omitRequestIdHeader` simula o
  // caso (raro, documentado) em que ele está ausente.
  const requestId = options.omitRequestIdHeader ? undefined : (options.requestId ?? randomUUID());

  const headers: Record<string, string> = {};
  if (!options.omitSignature) {
    const { header } = signWebhookNotification(secret, dataId, requestId);
    headers["x-signature"] = options.badSignature ? "ts=1,v1=deadbeef" : header;
  }
  if (requestId) {
    headers["x-request-id"] = requestId;
  }

  return {
    method: "POST" as const,
    url: `/api/webhooks/mercadopago?data.id=${dataId}&type=payment`,
    headers,
    payload: {
      action: "payment.updated",
      api_version: "v1",
      data: { id: dataId },
      date_created: new Date().toISOString(),
      id: 123,
      live_mode: false,
      type: options.type ?? "payment",
      user_id: 1,
    },
  };
}

/** Payload de resposta de `GET /v1/payments/{id}` (mockado no client do SDK). */
export function buildPaymentFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: overrides.id ?? "999999999",
    status: "approved",
    status_detail: "accredited",
    external_reference: undefined,
    transaction_amount: 25,
    ...overrides,
  };
}

"use client";

import { useState } from "react";

/**
 * Gera um `clientRequestId` (UUID) uma única vez por tentativa de doação e o
 * mantém estável entre re-renders — inclusive em reenvios após erro (retry),
 * garantindo que o backend trate múltiplas tentativas como a mesma doação
 * (idempotência via `clientRequestId`, ver Etapa 4).
 *
 * Limitação assumida: o id vive só em memória do componente. Um refresh de
 * página no meio do fluxo gera um novo id (nova Donation no backend) — para
 * o escopo desta etapa isso é aceitável; persistir em sessionStorage fica
 * para uma etapa futura, se necessário.
 */
export function useClientRequestId(): string {
  const [clientRequestId] = useState(() => crypto.randomUUID());
  return clientRequestId;
}

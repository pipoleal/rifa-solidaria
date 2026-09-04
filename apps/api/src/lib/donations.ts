import { Prisma } from "../generated/prisma/client.js";
import type { Donation } from "../generated/prisma/client.js";
import { DonationStatus } from "../generated/prisma/enums.js";
import { prisma } from "./prisma.js";

export type NewDonationInput = {
  campaignId: string;
  clientRequestId: string;
  donorName: string;
  donorEmail: string;
  amount: number;
  isPublic: boolean;
};

/**
 * Cria a Donation ou recupera a existente para o mesmo `clientRequestId`.
 *
 * Concorrência: não faz SELECT seguido de INSERT (racy). Tenta o INSERT
 * diretamente e confia na constraint UNIQUE de `client_request_id` — se duas
 * requisições concorrentes chegarem com o mesmo clientRequestId, o banco
 * garante que só uma delas grava; a outra recebe a violação (P2002) e
 * relê a linha já criada pela primeira.
 */
export async function findOrCreateDonation(input: NewDonationInput): Promise<Donation> {
  try {
    return await prisma.donation.create({ data: input });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.donation.findUnique({
        where: { clientRequestId: input.clientRequestId },
      });
      if (existing) {
        return existing;
      }
    }
    throw error;
  }
}

/**
 * Mapeamento oficial de status do pagamento clássico do Mercado Pago
 * (GET /v1/payments/{id}) para o nosso DonationStatus.
 *
 * `in_mediation` e qualquer valor desconhecido retornam `undefined`
 * deliberadamente — nunca aprovamos automaticamente um status que não
 * reconhecemos, e uma disputa em andamento não corresponde a nenhum dos
 * nossos 5 estados (o desfecho real chega depois como refunded/charged_back,
 * ou o dinheiro permanece approved se a disputa for resolvida a nosso favor).
 */
const PAYMENT_STATUS_MAP: Record<string, DonationStatus | undefined> = {
  pending: DonationStatus.PENDING,
  in_process: DonationStatus.PENDING,
  authorized: DonationStatus.PENDING,
  approved: DonationStatus.APPROVED,
  rejected: DonationStatus.REJECTED,
  cancelled: DonationStatus.CANCELLED,
  refunded: DonationStatus.REFUNDED,
  charged_back: DonationStatus.REFUNDED,
};

export function mapPaymentStatus(status: string | undefined): DonationStatus | undefined {
  if (!status) {
    return undefined;
  }
  return PAYMENT_STATUS_MAP[status];
}

const ALL_DONATION_STATUSES: readonly DonationStatus[] = [
  DonationStatus.PENDING,
  DonationStatus.APPROVED,
  DonationStatus.REJECTED,
  DonationStatus.CANCELLED,
  DonationStatus.REFUNDED,
];

/**
 * Máquina de estados da Donation. Única fonte de verdade das transições
 * permitidas — `applyPaymentStatus` deriva o guard do UPDATE a partir daqui
 * em vez de duplicar a tabela em SQL, para não haver duas versões da regra
 * que possam divergir.
 */
export function isTransitionAllowed(current: DonationStatus, next: DonationStatus): boolean {
  if (current === DonationStatus.PENDING) {
    return (
      next === DonationStatus.APPROVED ||
      next === DonationStatus.REJECTED ||
      next === DonationStatus.CANCELLED
    );
  }
  if (current === DonationStatus.APPROVED) {
    return next === DonationStatus.REFUNDED;
  }
  return false;
}

/**
 * Aplica uma transição de status vinda do webhook, de forma atômica e
 * condicional — um único UPDATE que só afeta a linha se a transição for
 * uma das permitidas por `isTransitionAllowed`. Cobre, no mesmo mecanismo:
 *  - idempotência (mesmo mp_payment_id reenviado não duplica nada);
 *  - concorrência (duas notificações simultâneas — o UPDATE é atômico
 *    no Postgres, sem necessidade de SELECT FOR UPDATE);
 *  - notificação fora de ordem (uma transição não permitida — ex.:
 *    tentar voltar de APPROVED para PENDING — simplesmente não casa
 *    com o WHERE e não afeta nenhuma linha).
 *
 * Retorna `true` se a transição foi aplicada, `false` se não afetou
 * nenhuma linha (idempotente/fora de ordem/estado terminal — não é erro) OU
 * se `mp_payment_id` já pertence a OUTRA Donation (conflito genuíno: um
 * `external_reference` apontando para uma linha diferente da que já é dona
 * daquele `payment_id` — o índice único parcial de `mp_payment_id`, Etapa 2,
 * rejeita a escrita). Isso não é recuperável por retry, então não deve
 * propagar como exceção — só é logado pelo chamador.
 *
 * A detecção do código de erro (`P2010`, "raw query failed", envolvendo a
 * violação de constraint do driver) é o comportamento esperado do Prisma
 * para `$executeRaw`, mas não foi confirmado contra um Postgres real nesta
 * sessão (sem credenciais disponíveis) — ver README.
 */
export async function applyPaymentStatus(
  donationId: string,
  paymentId: string,
  newStatus: DonationStatus,
): Promise<boolean> {
  const allowedCurrentStatuses = ALL_DONATION_STATUSES.filter((status) =>
    isTransitionAllowed(status, newStatus),
  );
  if (allowedCurrentStatuses.length === 0) {
    return false;
  }

  try {
    const affected = await prisma.$executeRaw`
      UPDATE donations
      SET status = ${newStatus}::"DonationStatus",
          mp_payment_id = ${paymentId},
          updated_at = now()
      WHERE id = ${donationId}::uuid
        AND (mp_payment_id IS NULL OR mp_payment_id = ${paymentId})
        AND status = ANY(${allowedCurrentStatuses}::"DonationStatus"[])
    `;
    return affected > 0;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2010") {
      return false;
    }
    throw error;
  }
}

import {
  apiErrorResponseSchema,
  createPaymentRequestSchema,
  createPaymentResponseSchema,
  donationStatusResponseSchema,
} from "@solidaria/shared";
import rateLimit from "@fastify/rate-limit";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { MercadoPagoError } from "mercadopago";
import { z } from "zod";
import { DonationStatus } from "../generated/prisma/enums.js";
import { findOrCreateDonation } from "../lib/donations.js";
import { paymentClient } from "../lib/mercadopago.js";
import { prisma } from "../lib/prisma.js";

const TERMINAL_STATUSES: readonly DonationStatus[] = [
  DonationStatus.APPROVED,
  DonationStatus.REJECTED,
  DonationStatus.CANCELLED,
  DonationStatus.REFUNDED,
];

/** Divide "Nome Completo" em first/last name — a API do Mercado Pago exige os dois. */
function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  const firstName = parts[0] ?? fullName;
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : firstName;
  return { firstName, lastName };
}

type PixData = {
  qrCode?: string;
  qrCodeBase64?: string;
  ticketUrl?: string;
};

function extractPixData(payment: { point_of_interaction?: unknown }): PixData {
  const transactionData = (
    payment.point_of_interaction as
      | { transaction_data?: { qr_code?: string; qr_code_base64?: string; ticket_url?: string } }
      | undefined
  )?.transaction_data;
  return {
    qrCode: transactionData?.qr_code,
    qrCodeBase64: transactionData?.qr_code_base64,
    ticketUrl: transactionData?.ticket_url,
  };
}

export const paymentsRoutes: FastifyPluginAsyncZod = async (app) => {
  const backendPublicUrl = process.env.BACKEND_PUBLIC_URL;
  if (!backendPublicUrl) {
    throw new Error("BACKEND_PUBLIC_URL não está definida.");
  }
  const notificationUrl = `${backendPublicUrl}/api/webhooks/mercadopago`;

  await app.register(rateLimit, {
    max: 5,
    timeWindow: "1 minute",
    // O plugin faz `throw` direto do valor retornado aqui — precisa carregar
    // `statusCode` para o error handler global (app.ts) responder com 429 em
    // vez de cair no fallback genérico de 500.
    errorResponseBuilder: (_request, context) =>
      Object.assign(new Error("Muitas requisições. Tente novamente em instantes."), {
        statusCode: context.statusCode,
        error: {
          code: "RATE_LIMITED",
          message: "Muitas requisições. Tente novamente em instantes.",
        },
      }),
  });

  app.post(
    "/api/payments/create",
    {
      schema: {
        body: createPaymentRequestSchema,
        response: {
          201: createPaymentResponseSchema,
          400: apiErrorResponseSchema,
          404: apiErrorResponseSchema,
          409: apiErrorResponseSchema,
          429: apiErrorResponseSchema,
          502: apiErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { clientRequestId, campaignId, amount, donorName, donorEmail, isPublic } = request.body;

      const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
      if (!campaign || !campaign.isActive) {
        return reply.status(404).send({
          error: {
            code: "CAMPAIGN_NOT_FOUND",
            message: "Campanha não encontrada ou inativa.",
          },
        });
      }

      const donation = await findOrCreateDonation({
        campaignId,
        clientRequestId,
        donorName,
        donorEmail,
        amount,
        isPublic,
      });

      if (TERMINAL_STATUSES.includes(donation.status)) {
        return reply.status(409).send({
          error: {
            code: "DONATION_ALREADY_FINALIZED",
            message: `Esta doação já foi concluída (status: ${donation.status}).`,
          },
        });
      }

      const { firstName, lastName } = splitName(donorName);

      if (donation.mpPaymentId) {
        try {
          const existingPayment = await paymentClient.get({ id: donation.mpPaymentId });
          return reply.status(201).send({ donationId: donation.id, ...extractPixData(existingPayment) });
        } catch (error) {
          app.log.error(
            { paymentId: donation.mpPaymentId, error: error instanceof Error ? error.message : String(error) },
            "Falha ao reconsultar pagamento Pix existente no Mercado Pago",
          );
          return reply.status(502).send({
            error: {
              code: "PAYMENT_PROVIDER_ERROR",
              message: "Não foi possível recuperar o pagamento. Tente novamente.",
            },
          });
        }
      }

      try {
        const payment = await paymentClient.create({
          body: {
            transaction_amount: amount / 100,
            description: `Doação — ${campaign.title}`,
            payment_method_id: "pix",
            payer: { email: donorEmail, first_name: firstName, last_name: lastName },
            external_reference: donation.id,
            notification_url: notificationUrl,
          },
          requestOptions: { idempotencyKey: donation.id },
        });

        if (!payment.id) {
          throw new Error("Resposta do Mercado Pago sem id de pagamento.");
        }

        await prisma.donation.update({
          where: { id: donation.id },
          data: { mpPaymentId: String(payment.id) },
        });

        return reply.status(201).send({ donationId: donation.id, ...extractPixData(payment) });
      } catch (error) {
        if (error instanceof MercadoPagoError) {
          app.log.error(
            { status: error.status, message: error.message, causes: error.causes },
            "Falha ao criar pagamento Pix no Mercado Pago",
          );
        } else {
          app.log.error(error, "Falha inesperada ao criar pagamento Pix no Mercado Pago");
        }

        return reply.status(502).send({
          error: {
            code: "PAYMENT_PROVIDER_ERROR",
            message: "Não foi possível iniciar o pagamento. Tente novamente.",
          },
        });
      }
    },
  );

  app.get(
    "/api/donations/:id/status",
    {
      // Sobrescreve o limite de 5/min do registro acima — essa rota é feita
      // pra ser consultada em polling (a cada poucos segundos) enquanto o
      // doador aguarda a confirmação do Pix.
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: {
        params: z.object({ id: z.uuid() }),
        response: {
          200: donationStatusResponseSchema,
          400: apiErrorResponseSchema,
          404: apiErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const donation = await prisma.donation.findUnique({ where: { id }, select: { status: true } });
      if (!donation) {
        return reply.status(404).send({
          error: { code: "DONATION_NOT_FOUND", message: "Doação não encontrada." },
        });
      }
      return reply.status(200).send({ status: donation.status });
    },
  );
};

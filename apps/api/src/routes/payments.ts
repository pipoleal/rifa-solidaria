import {
  apiErrorResponseSchema,
  createPaymentRequestSchema,
  createPaymentResponseSchema,
} from "@solidaria/shared";
import rateLimit from "@fastify/rate-limit";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { MercadoPagoError } from "mercadopago";
import { DonationStatus } from "../generated/prisma/enums.js";
import { findOrCreateDonation } from "../lib/donations.js";
import { preferenceClient } from "../lib/mercadopago.js";
import { prisma } from "../lib/prisma.js";

const TERMINAL_STATUSES: readonly DonationStatus[] = [
  DonationStatus.APPROVED,
  DonationStatus.REJECTED,
  DonationStatus.CANCELLED,
  DonationStatus.REFUNDED,
];

export const paymentsRoutes: FastifyPluginAsyncZod = async (app) => {
  const backendPublicUrl = process.env.BACKEND_PUBLIC_URL;
  if (!backendPublicUrl) {
    throw new Error("BACKEND_PUBLIC_URL não está definida.");
  }
  const notificationUrl = `${backendPublicUrl}/api/webhooks/mercadopago`;

  const frontendUrl = process.env.FRONTEND_URL;
  if (!frontendUrl) {
    throw new Error("FRONTEND_URL não está definida.");
  }
  // Obrigatório pelo Mercado Pago quando `auto_return` é usado — sem
  // `back_urls.success`, a API rejeita a criação da preferência com o erro
  // `invalid_auto_return` ("back_url.success must be defined").
  const backUrls = {
    success: `${frontendUrl}/doacao/sucesso`,
    pending: `${frontendUrl}/doacao/pendente`,
    failure: `${frontendUrl}/doacao/erro`,
  };

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

      if (donation.mpPreferenceId && donation.mpInitPoint) {
        return reply.status(201).send({
          donationId: donation.id,
          initPoint: donation.mpInitPoint,
        });
      }

      try {
        const preference = await preferenceClient.create({
          body: {
            items: [
              {
                id: donation.id,
                title: `Doação — ${campaign.title}`,
                quantity: 1,
                currency_id: "BRL",
                unit_price: amount / 100,
              },
            ],
            payer: { name: donorName, email: donorEmail },
            external_reference: donation.id,
            notification_url: notificationUrl,
            back_urls: backUrls,
            auto_return: "approved",
          },
        });

        if (!preference.id || !preference.init_point) {
          throw new Error("Resposta do Mercado Pago sem id/init_point.");
        }

        await prisma.donation.update({
          where: { id: donation.id },
          data: { mpPreferenceId: preference.id, mpInitPoint: preference.init_point },
        });

        return reply.status(201).send({
          donationId: donation.id,
          initPoint: preference.init_point,
        });
      } catch (error) {
        if (error instanceof MercadoPagoError) {
          app.log.error(
            { status: error.status, message: error.message, causes: error.causes },
            "Falha ao criar preferência no Mercado Pago",
          );
        } else {
          app.log.error(error, "Falha inesperada ao criar preferência no Mercado Pago");
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
};

import rateLimit from "@fastify/rate-limit";
import { InvalidWebhookSignatureError, WebhookSignatureValidator } from "mercadopago";
import { z } from "zod";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { applyPaymentStatus, mapPaymentStatus } from "../lib/donations.js";
import { paymentClient } from "../lib/mercadopago.js";
import { prisma } from "../lib/prisma.js";

const webhookNotificationSchema = z.object({
  type: z.string(),
  data: z.object({ id: z.string() }).optional(),
});

// Tolerância de replay para o `ts` da assinatura — não é um valor exigido
// pela documentação do Mercado Pago (que não especifica uma janela), é uma
// escolha defensiva nossa. Ver README.
const SIGNATURE_TOLERANCE_SECONDS = 300;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export const webhookRoutes: FastifyPluginAsyncZod = async (app) => {
  const webhookSecret = process.env.MP_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error("MP_WEBHOOK_SECRET não está definida.");
  }

  // Defesa em profundidade contra flood de requisições forjadas (cada uma
  // custa um cálculo de HMAC antes do 401). Limite alto porque o Mercado
  // Pago pode legitimamente reenviar em rajada; não deve afetar tráfego real.
  await app.register(rateLimit, {
    max: 120,
    timeWindow: "1 minute",
    errorResponseBuilder: (_request, context) =>
      Object.assign(new Error("Muitas requisições."), {
        statusCode: context.statusCode,
        error: { code: "RATE_LIMITED", message: "Muitas requisições." },
      }),
  });

  app.post(
    "/api/webhooks/mercadopago",
    { schema: { body: webhookNotificationSchema } },
    async (request, reply) => {
      const dataIdFromQuery = firstValue(
        (request.query as Record<string, string | string[] | undefined>)["data.id"],
      );

      try {
        WebhookSignatureValidator.validate({
          xSignature: request.headers["x-signature"],
          xRequestId: request.headers["x-request-id"],
          dataId: dataIdFromQuery,
          secret: webhookSecret,
          toleranceSeconds: SIGNATURE_TOLERANCE_SECONDS,
        });
      } catch (error) {
        if (error instanceof InvalidWebhookSignatureError) {
          // DIAGNÓSTICO TEMPORÁRIO — remover depois de identificar a causa do
          // SignatureMismatch intermitente. Loga só o que o Mercado Pago
          // envia (nunca o secret nem o hash computado).
          app.log.warn(
            {
              reason: error.reason,
              requestId: error.requestId,
              rawXSignature: request.headers["x-signature"],
              rawXRequestId: request.headers["x-request-id"],
              dataIdFromQuery,
            },
            "Webhook do Mercado Pago com assinatura inválida",
          );
          return reply.status(401).send({
            error: { code: "INVALID_SIGNATURE", message: "Assinatura inválida." },
          });
        }
        throw error;
      }

      const { type, data } = request.body;
      if (type !== "payment") {
        return reply.status(200).send({ received: true });
      }

      const paymentId = dataIdFromQuery ?? data?.id;
      if (!paymentId) {
        app.log.warn("Notificação de pagamento sem data.id identificável");
        return reply.status(200).send({ received: true });
      }

      let payment;
      try {
        payment = await paymentClient.get({ id: paymentId });
      } catch (error) {
        app.log.error(
          { paymentId, error: error instanceof Error ? error.message : String(error) },
          "Falha ao consultar pagamento no Mercado Pago",
        );
        return reply.status(500).send({
          error: { code: "PAYMENT_LOOKUP_FAILED", message: "Falha ao consultar pagamento." },
        });
      }

      const donationId = payment.external_reference;
      if (!donationId) {
        app.log.warn({ paymentId }, "Pagamento sem external_reference");
        return reply.status(200).send({ received: true });
      }

      const donation = await prisma.donation.findUnique({ where: { id: donationId } });
      if (!donation) {
        app.log.warn(
          { paymentId, donationId },
          "external_reference não corresponde a nenhuma Donation",
        );
        return reply.status(200).send({ received: true });
      }

      const newStatus = mapPaymentStatus(payment.status);
      if (!newStatus) {
        app.log.info(
          { paymentId, donationId, status: payment.status },
          "Status do pagamento sem mapeamento — nenhuma alteração aplicada",
        );
        return reply.status(200).send({ received: true });
      }

      if (payment.transaction_amount != null) {
        const receivedCents = Math.round(payment.transaction_amount * 100);
        if (Math.abs(receivedCents - donation.amount) > 1) {
          app.log.warn(
            { paymentId, donationId, expectedCents: donation.amount, receivedCents },
            "Divergência entre transaction_amount do Mercado Pago e Donation.amount",
          );
        }
      }

      const applied = await applyPaymentStatus(donation.id, String(paymentId), newStatus);
      if (!applied) {
        app.log.info(
          { paymentId, donationId, newStatus },
          "Transição não aplicada (idempotente, fora de ordem ou estado terminal)",
        );
      }

      return reply.status(200).send({ received: true });
    },
  );
};

import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import Fastify from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { campaignRoutes } from "./routes/campaign.js";
import { healthRoutes } from "./routes/health.js";
import { paymentsRoutes } from "./routes/payments.js";
import { webhookRoutes } from "./routes/webhooks.js";

type ApiErrorPayload = { error: { code: string; message: string } };

function getStatusCode(error: unknown): number {
  if (typeof error === "object" && error !== null && "statusCode" in error) {
    const { statusCode } = error as { statusCode: unknown };
    if (typeof statusCode === "number") {
      return statusCode;
    }
  }
  return 500;
}

function isApiErrorPayload(value: unknown): value is ApiErrorPayload {
  if (typeof value !== "object" || value === null || !("error" in value)) {
    return false;
  }
  const { error } = value as { error: unknown };
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { message?: unknown }).message === "string"
  );
}

export function buildApp() {
  const app = Fastify({
    logger: process.env.NODE_ENV !== "test",
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const frontendUrl = process.env.FRONTEND_URL;
  if (!frontendUrl) {
    throw new Error("FRONTEND_URL não está definida.");
  }
  app.register(cors, { origin: frontendUrl });
  // API pura em JSON (não serve HTML) — os cabeçalhos default do Helmet
  // (nosniff, no-referrer, etc.) bastam; CSP não é relevante aqui.
  app.register(helmet);

  app.setErrorHandler((error, _request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.status(400).send({
        error: { code: "VALIDATION_ERROR", message: "Dados inválidos na requisição." },
      });
    }

    const statusCode = getStatusCode(error);

    // Erros conhecidos (4xx) que já vêm no formato { error: { code, message } }
    // — ex.: rate limit — são só repassados com o status correto. Qualquer
    // outra coisa (bug nosso, falha do banco, erro sem forma conhecida) é
    // tratada como interna e nunca vaza detalhe para o cliente.
    if (statusCode < 500) {
      if (isApiErrorPayload(error)) {
        // Enviar `error` diretamente (quando é uma instância de Error, como a
        // que o @fastify/rate-limit lança) faria o Fastify aplicar sua própria
        // serialização especial de Error — que sobrescreve nosso `error.error`
        // por uma string de motivo HTTP. Por isso extraímos um objeto plano.
        return reply.status(statusCode).send({ error: error.error });
      }
      // 4xx genuíno vindo do próprio Fastify (ex.: corpo JSON malformado)
      // sem o nosso envelope — ainda assim não é um erro interno nosso.
      return reply.status(statusCode).send({
        error: { code: "BAD_REQUEST", message: "Requisição inválida." },
      });
    }

    app.log.error(error);
    return reply.status(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "Erro interno. Tente novamente mais tarde.",
      },
    });
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({
      error: {
        code: "NOT_FOUND",
        message: "Rota não encontrada.",
      },
    });
  });

  app.register(healthRoutes);
  app.register(campaignRoutes);
  app.register(paymentsRoutes);
  app.register(webhookRoutes);

  return app;
}

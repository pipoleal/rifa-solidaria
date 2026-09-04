import { apiErrorResponseSchema, campaignResponseSchema } from "@solidaria/shared";
import rateLimit from "@fastify/rate-limit";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { DonationStatus } from "../generated/prisma/enums.js";
import { prisma } from "../lib/prisma.js";

export const campaignRoutes: FastifyPluginAsyncZod = async (app) => {
  // Endpoint público de leitura (sem custo de terceiros como /payments/create),
  // mas ainda bate no banco a cada chamada — limite generoso só para conter
  // varredura/abuso automatizado, não para tráfego legítimo.
  await app.register(rateLimit, { max: 60, timeWindow: "1 minute" });

  app.get(
    "/api/campaign",
    {
      schema: {
        response: {
          200: campaignResponseSchema,
          404: apiErrorResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      const campaign = await prisma.campaign.findFirst({
        where: { isActive: true },
        orderBy: { createdAt: "asc" },
      });

      if (!campaign) {
        return reply.status(404).send({
          error: {
            code: "CAMPAIGN_NOT_FOUND",
            message: "Campanha ativa não encontrada.",
          },
        });
      }

      const aggregate = await prisma.donation.aggregate({
        where: { campaignId: campaign.id, status: DonationStatus.APPROVED },
        _sum: { amount: true },
      });

      // A meta não precisa ser exata ao segundo; cache curto reduz carga no
      // banco sob tráfego repetido (ex.: vários visitantes na mesma janela).
      void reply.header("Cache-Control", "public, max-age=30");

      return {
        id: campaign.id,
        title: campaign.title,
        slug: campaign.slug,
        story: campaign.story,
        goalAmount: campaign.goalAmount,
        currentAmount: aggregate._sum.amount ?? 0,
        coverImageUrl: campaign.coverImageUrl,
      };
    },
  );
};

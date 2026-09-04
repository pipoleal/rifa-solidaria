import { z } from "zod";

export const campaignResponseSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  slug: z.string(),
  story: z.string(),
  goalAmount: z.int().nonnegative(),
  currentAmount: z.int().nonnegative(),
  coverImageUrl: z.string().nullable(),
});

export type CampaignResponse = z.infer<typeof campaignResponseSchema>;

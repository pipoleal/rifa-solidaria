import { z } from "zod";

// TEMPORÁRIO para teste de webhook — reverter para 500 (R$ 5,00) depois.
export const MIN_DONATION_AMOUNT_CENTS = 1; // R$ 0,01
export const MAX_DONATION_AMOUNT_CENTS = 5_000_000; // R$ 50.000,00 — limite defensivo, ajustável

export const createPaymentRequestSchema = z.object({
  clientRequestId: z.uuid(),
  campaignId: z.uuid(),
  amount: z.int().positive().min(MIN_DONATION_AMOUNT_CENTS).max(MAX_DONATION_AMOUNT_CENTS),
  donorName: z.string().trim().min(2).max(120),
  donorEmail: z.string().trim().toLowerCase().email().max(254),
  isPublic: z.boolean().default(false),
});

export type CreatePaymentRequest = z.infer<typeof createPaymentRequestSchema>;

export const createPaymentResponseSchema = z.object({
  donationId: z.uuid(),
  initPoint: z.url(),
});

export type CreatePaymentResponse = z.infer<typeof createPaymentResponseSchema>;

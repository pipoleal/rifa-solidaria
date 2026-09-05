import { z } from "zod";

export const MIN_DONATION_AMOUNT_CENTS = 500; // R$ 5,00
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

// Resposta do Checkout Transparente com Pix — sem redirecionamento, o
// pagamento é exibido na própria página via QR code / copia-e-cola.
export const createPaymentResponseSchema = z.object({
  donationId: z.uuid(),
  qrCode: z.string().optional(),
  qrCodeBase64: z.string().optional(),
  ticketUrl: z.url().optional(),
});

export type CreatePaymentResponse = z.infer<typeof createPaymentResponseSchema>;

export const donationStatusResponseSchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED", "REFUNDED"]),
});

export type DonationStatusResponse = z.infer<typeof donationStatusResponseSchema>;

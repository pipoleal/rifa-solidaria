import { randomUUID } from "node:crypto";
import { Prisma } from "../generated/prisma/client.js";
import { DonationStatus, PaymentProvider } from "../generated/prisma/enums.js";

export type FakeCampaign = {
  id: string;
  title: string;
  slug: string;
  story: string;
  goalAmount: number;
  coverImageUrl: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type FakeDonation = {
  id: string;
  campaignId: string;
  clientRequestId: string;
  donorName: string;
  donorEmail: string;
  amount: number;
  status: DonationStatus;
  paymentProvider: PaymentProvider;
  mpPreferenceId: string | null;
  mpInitPoint: string | null;
  mpPaymentId: string | null;
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type NewDonationData = {
  campaignId: string;
  clientRequestId: string;
  donorName: string;
  donorEmail: string;
  amount: number;
  isPublic: boolean;
};

/**
 * Dublê de teste do Prisma Client — só implementa o subconjunto de métodos
 * que as rotas de pagamento realmente chamam. `donation.create` simula, sob
 * concorrência real (via microtask), a constraint UNIQUE de `clientRequestId`
 * do Postgres real: duas chamadas concorrentes com o mesmo valor resultam em
 * uma única linha, e a segunda lança o mesmo erro (P2002) que o driver real
 * lançaria. Isso testa a lógica de recuperação do código; não substitui uma
 * verificação de atomicidade contra um Postgres real (ver README).
 */
export function createFakePrisma() {
  const campaigns = new Map<string, FakeCampaign>();
  const donationsById = new Map<string, FakeDonation>();
  const donationIdByClientRequestId = new Map<string, string>();
  const donationIdByMpPaymentId = new Map<string, string>();

  const fakePrisma = {
    campaign: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        return campaigns.get(where.id) ?? null;
      },
      findFirst: async ({
        where,
      }: {
        where?: { isActive?: boolean };
        orderBy?: { createdAt?: "asc" | "desc" };
      }): Promise<FakeCampaign | null> => {
        const candidates = [...campaigns.values()]
          .filter(
            (campaign) => where?.isActive === undefined || campaign.isActive === where.isActive,
          )
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        return candidates[0] ?? null;
      },
    },
    donation: {
      aggregate: async ({
        where,
      }: {
        where: { campaignId: string; status?: DonationStatus };
      }): Promise<{ _sum: { amount: number | null } }> => {
        const matching = [...donationsById.values()].filter(
          (donation) =>
            donation.campaignId === where.campaignId &&
            (where.status === undefined || donation.status === where.status),
        );
        if (matching.length === 0) {
          return { _sum: { amount: null } };
        }
        const total = matching.reduce((sum, donation) => sum + donation.amount, 0);
        return { _sum: { amount: total } };
      },
      create: async ({ data }: { data: NewDonationData }): Promise<FakeDonation> => {
        await Promise.resolve();

        if (donationIdByClientRequestId.has(data.clientRequestId)) {
          throw new Prisma.PrismaClientKnownRequestError(
            "Unique constraint failed on the fields: (`client_request_id`)",
            { code: "P2002", clientVersion: "test", meta: { target: ["client_request_id"] } },
          );
        }

        const id = randomUUID();
        const donation: FakeDonation = {
          id,
          campaignId: data.campaignId,
          clientRequestId: data.clientRequestId,
          donorName: data.donorName,
          donorEmail: data.donorEmail,
          amount: data.amount,
          isPublic: data.isPublic,
          status: DonationStatus.PENDING,
          paymentProvider: PaymentProvider.MERCADO_PAGO,
          mpPreferenceId: null,
          mpInitPoint: null,
          mpPaymentId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        donationIdByClientRequestId.set(data.clientRequestId, id);
        donationsById.set(id, donation);
        return donation;
      },
      findUnique: async ({
        where,
      }: {
        where: { id?: string; clientRequestId?: string };
      }): Promise<FakeDonation | null> => {
        if (where.clientRequestId) {
          const id = donationIdByClientRequestId.get(where.clientRequestId);
          return id ? (donationsById.get(id) ?? null) : null;
        }
        if (where.id) {
          return donationsById.get(where.id) ?? null;
        }
        return null;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<FakeDonation>;
      }): Promise<FakeDonation> => {
        const existing = donationsById.get(where.id);
        if (!existing) {
          throw new Error(`Donation ${where.id} não encontrada no fake.`);
        }
        const updated: FakeDonation = { ...existing, ...data, updatedAt: new Date() };
        donationsById.set(where.id, updated);
        return updated;
      },
    },
    // Acoplado de propósito à ordem exata dos interpolados em
    // `applyPaymentStatus` (lib/donations.ts): values[0]=newStatus,
    // values[1]=paymentId, values[2]=donationId, values[4]=allowedCurrentStatuses.
    // Se aquela função mudar a ordem/quantidade de parâmetros, atualizar aqui.
    $executeRaw: async (_strings: TemplateStringsArray, ...values: unknown[]): Promise<number> => {
      await Promise.resolve();
      const newStatus = values[0] as DonationStatus;
      const paymentId = values[1] as string;
      const donationId = values[2] as string;
      const allowedCurrentStatuses = values[4] as DonationStatus[];

      const existing = donationsById.get(donationId);
      if (!existing) {
        return 0;
      }
      if (existing.mpPaymentId && existing.mpPaymentId !== paymentId) {
        return 0;
      }
      if (!allowedCurrentStatuses.includes(existing.status)) {
        return 0;
      }

      // Simula o índice único parcial de mp_payment_id (Etapa 2): se OUTRA
      // Donation já é dona desse payment_id, a escrita é rejeitada — igual
      // a uma violação de UNIQUE constraint num Postgres real.
      const ownerId = donationIdByMpPaymentId.get(paymentId);
      if (ownerId && ownerId !== donationId) {
        throw new Prisma.PrismaClientKnownRequestError("Raw query failed. Code: `23505`.", {
          code: "P2010",
          clientVersion: "test",
          meta: { code: "23505", message: "duplicate key value violates unique constraint" },
        });
      }

      donationIdByMpPaymentId.set(paymentId, donationId);
      donationsById.set(donationId, {
        ...existing,
        status: newStatus,
        mpPaymentId: paymentId,
        updatedAt: new Date(),
      });
      return 1;
    },
  };

  function seedCampaign(campaign: FakeCampaign): void {
    campaigns.set(campaign.id, campaign);
  }

  function getDonation(id: string): FakeDonation | undefined {
    return donationsById.get(id);
  }

  function getDonationByClientRequestId(clientRequestId: string): FakeDonation | undefined {
    const id = donationIdByClientRequestId.get(clientRequestId);
    return id ? donationsById.get(id) : undefined;
  }

  function countDonations(): number {
    return donationsById.size;
  }

  function reset(): void {
    campaigns.clear();
    donationsById.clear();
    donationIdByClientRequestId.clear();
    donationIdByMpPaymentId.clear();
  }

  return {
    fakePrisma,
    seedCampaign,
    getDonation,
    getDonationByClientRequestId,
    countDonations,
    reset,
  };
}

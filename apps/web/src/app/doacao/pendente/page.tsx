import type { Metadata } from "next";

export const metadata: Metadata = { title: "Pagamento em processamento" };

export default function DonationPendingPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <h1 className="text-2xl font-bold text-amber-700">Pagamento em processamento</h1>
      <p className="mt-3 max-w-md text-slate-600">
        Assim que o Mercado Pago confirmar o pagamento, sua doação será registrada automaticamente.
      </p>
      <a href="/" className="focus-ring mt-6 text-sm font-semibold text-emerald-700 underline">
        Voltar para a campanha
      </a>
    </main>
  );
}

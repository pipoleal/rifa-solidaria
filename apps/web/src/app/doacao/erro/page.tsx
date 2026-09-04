import type { Metadata } from "next";

export const metadata: Metadata = { title: "Não foi possível concluir o pagamento" };

export default function DonationErrorPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <h1 className="text-2xl font-bold text-red-700">Não foi possível concluir o pagamento</h1>
      <p className="mt-3 max-w-md text-slate-600">
        Nenhuma cobrança foi feita. Você pode tentar novamente quando quiser.
      </p>
      <a href="/" className="focus-ring mt-6 text-sm font-semibold text-emerald-700 underline">
        Tentar novamente
      </a>
    </main>
  );
}

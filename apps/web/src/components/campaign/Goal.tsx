import { centsToBRL, progressPercentage } from "@/lib/money";

export function Goal({ currentAmount, goalAmount }: { currentAmount: number; goalAmount: number }) {
  const percentage = progressPercentage(currentAmount, goalAmount);

  return (
    <section className="bg-slate-50 px-4 py-16">
      <div className="mx-auto max-w-3xl">
        <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">Objetivo</h2>
        <div className="mt-6" role="group" aria-label="Progresso da meta de arrecadação">
          <div className="flex items-baseline justify-between text-sm text-slate-600">
            <span className="text-lg font-semibold text-emerald-700">
              {centsToBRL(currentAmount)}
            </span>
            <span>de {centsToBRL(goalAmount)}</span>
          </div>
          <div
            className="mt-2 h-4 w-full overflow-hidden rounded-full bg-slate-200"
            role="progressbar"
            aria-valuenow={percentage}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full bg-emerald-600 transition-all"
              style={{ width: `${String(percentage)}%` }}
            />
          </div>
          <p className="mt-2 text-sm text-slate-500">{percentage}% da meta atingida</p>
        </div>
      </div>
    </section>
  );
}

/** Converte um valor em reais (ex.: 25.5) para centavos inteiros (ex.: 2550). */
export function reaisToCents(reais: number): number {
  return Math.round(reais * 100);
}

/** Formata um valor em centavos como moeda brasileira (ex.: 2550 -> "R$ 25,50"). */
export function centsToBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

/** Percentual da meta atingido, limitado visualmente a 100%. */
export function progressPercentage(currentAmount: number, goalAmount: number): number {
  if (goalAmount <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((currentAmount / goalAmount) * 100));
}

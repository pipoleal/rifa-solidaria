import { describe, expect, it } from "vitest";
import { centsToBRL, progressPercentage, reaisToCents } from "./money";

describe("reaisToCents", () => {
  it("converte reais inteiros para centavos", () => {
    expect(reaisToCents(25)).toBe(2500);
  });

  it("converte reais com centavos para centavos", () => {
    expect(reaisToCents(25.5)).toBe(2550);
  });

  it("arredonda valores com imprecisão de ponto flutuante", () => {
    expect(reaisToCents(19.99)).toBe(1999);
  });

  it("converte zero", () => {
    expect(reaisToCents(0)).toBe(0);
  });
});

describe("centsToBRL", () => {
  it("formata centavos como moeda brasileira", () => {
    const formatted = centsToBRL(2500);
    expect(formatted).toContain("25,00");
    expect(formatted).toContain("R$");
  });

  it("formata valores com centavos não redondos", () => {
    expect(centsToBRL(2550)).toContain("25,50");
  });
});

describe("progressPercentage", () => {
  it("calcula o percentual normalmente", () => {
    expect(progressPercentage(50_00, 100_00)).toBe(50);
  });

  it("limita visualmente a 100% quando arrecadado excede a meta", () => {
    expect(progressPercentage(150_00, 100_00)).toBe(100);
  });

  it("retorna 0 quando a meta é 0 (evita divisão por zero)", () => {
    expect(progressPercentage(0, 0)).toBe(0);
  });

  it("retorna 0 quando nada foi arrecadado", () => {
    expect(progressPercentage(0, 100_00)).toBe(0);
  });
});

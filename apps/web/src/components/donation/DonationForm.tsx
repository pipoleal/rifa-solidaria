"use client";

import { MAX_DONATION_AMOUNT_CENTS, MIN_DONATION_AMOUNT_CENTS } from "@solidaria/shared";
import { type FormEvent, useState } from "react";
import { createPayment } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/errorMessages";
import { centsToBRL, reaisToCents } from "@/lib/money";
import { useClientRequestId } from "@/lib/useClientRequestId";

const SUGGESTED_AMOUNTS_CENTS = [1000, 2500, 5000, 10000];

export function DonationForm({ campaignId }: { campaignId: string }) {
  const clientRequestId = useClientRequestId();

  const [selectedAmount, setSelectedAmount] = useState<number | null>(
    SUGGESTED_AMOUNTS_CENTS[1] ?? null,
  );
  const [isCustom, setIsCustom] = useState(false);
  const [customAmount, setCustomAmount] = useState("");
  const [donorName, setDonorName] = useState("");
  const [donorEmail, setDonorEmail] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const amountCents = isCustom
    ? reaisToCents(Number(customAmount.replace(",", ".")) || 0)
    : (selectedAmount ?? 0);

  const amountIsValid =
    amountCents >= MIN_DONATION_AMOUNT_CENTS && amountCents <= MAX_DONATION_AMOUNT_CENTS;
  const emailIsValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(donorEmail);
  const nameIsValid = donorName.trim().length >= 2;
  const formIsValid = amountIsValid && emailIsValid && nameIsValid;
  const showAmountError = !amountIsValid && (!isCustom || customAmount !== "");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formIsValid || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const result = await createPayment({
        clientRequestId,
        campaignId,
        amount: amountCents,
        donorName: donorName.trim(),
        donorEmail: donorEmail.trim(),
        isPublic,
      });
      window.location.href = result.initPoint;
    } catch (error) {
      setErrorMessage(friendlyErrorMessage(error));
      setIsSubmitting(false);
    }
  }

  return (
    <section id="doar" className="px-4 py-16">
      <div className="mx-auto max-w-xl">
        <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">Quero ajudar</h2>
        <form onSubmit={handleSubmit} noValidate className="mt-8 space-y-6">
          <fieldset>
            <legend className="text-sm font-semibold text-slate-900">Escolha um valor</legend>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
              {SUGGESTED_AMOUNTS_CENTS.map((amount) => (
                <button
                  key={amount}
                  type="button"
                  onClick={() => {
                    setIsCustom(false);
                    setSelectedAmount(amount);
                  }}
                  aria-pressed={!isCustom && selectedAmount === amount}
                  className={`focus-ring rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                    !isCustom && selectedAmount === amount
                      ? "border-emerald-600 bg-emerald-600 text-white"
                      : "border-slate-300 text-slate-700 hover:border-emerald-600"
                  }`}
                >
                  {centsToBRL(amount)}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setIsCustom(true);
                }}
                aria-pressed={isCustom}
                className={`focus-ring rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                  isCustom
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "border-slate-300 text-slate-700 hover:border-emerald-600"
                }`}
              >
                Outro valor
              </button>
            </div>
            {isCustom && (
              <div className="mt-3">
                <label htmlFor="custom-amount" className="sr-only">
                  Valor em reais
                </label>
                <input
                  id="custom-amount"
                  type="number"
                  inputMode="decimal"
                  min={MIN_DONATION_AMOUNT_CENTS / 100}
                  max={MAX_DONATION_AMOUNT_CENTS / 100}
                  step="0.01"
                  value={customAmount}
                  onChange={(event) => {
                    setCustomAmount(event.target.value);
                  }}
                  placeholder="Ex.: 30"
                  className="focus-ring w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            )}
            {showAmountError && (
              <p className="mt-2 text-sm text-red-600">
                O valor deve estar entre {centsToBRL(MIN_DONATION_AMOUNT_CENTS)} e{" "}
                {centsToBRL(MAX_DONATION_AMOUNT_CENTS)}.
              </p>
            )}
          </fieldset>

          <div>
            <label htmlFor="donor-name" className="text-sm font-semibold text-slate-900">
              Nome
            </label>
            <input
              id="donor-name"
              name="name"
              type="text"
              required
              value={donorName}
              onChange={(event) => {
                setDonorName(event.target.value);
              }}
              autoComplete="name"
              className="focus-ring mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label htmlFor="donor-email" className="text-sm font-semibold text-slate-900">
              E-mail
            </label>
            <input
              id="donor-email"
              name="email"
              type="email"
              required
              value={donorEmail}
              onChange={(event) => {
                setDonorEmail(event.target.value);
              }}
              autoComplete="email"
              className="focus-ring mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              id="is-public"
              type="checkbox"
              checked={isPublic}
              onChange={(event) => {
                setIsPublic(event.target.checked);
              }}
              className="focus-ring h-4 w-4 rounded border-slate-300"
            />
            <label htmlFor="is-public" className="text-sm text-slate-700">
              Quero aparecer publicamente como doador(a)
            </label>
          </div>

          {errorMessage && (
            <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
              {errorMessage}
            </p>
          )}

          <button
            type="submit"
            disabled={!formIsValid || isSubmitting}
            className="focus-ring w-full rounded-full bg-emerald-600 px-8 py-3 text-base font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {isSubmitting ? "Enviando..." : "QUERO AJUDAR"}
          </button>
        </form>
      </div>
    </section>
  );
}

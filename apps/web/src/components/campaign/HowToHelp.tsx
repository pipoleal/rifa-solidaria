const STEPS = [
  { title: "Escolha um valor", description: "R$10, R$25, R$50, R$100 ou o valor que preferir." },
  { title: "Preencha seus dados", description: "Nome e e-mail para confirmarmos sua doação." },
  {
    title: "Pague com segurança",
    description: "Você é redirecionado ao checkout oficial do Mercado Pago.",
  },
];

export function HowToHelp() {
  return (
    <section className="px-4 py-16">
      <div className="mx-auto max-w-3xl">
        <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">Como ajudar</h2>
        <ol className="mt-8 grid gap-6 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="rounded-xl border border-slate-200 p-5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white">
                {index + 1}
              </span>
              <h3 className="mt-3 font-semibold text-slate-900">{step.title}</h3>
              <p className="mt-1 text-sm text-slate-600">{step.description}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

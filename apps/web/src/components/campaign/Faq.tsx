const FAQ_ITEMS = [
  {
    question: "O dinheiro vai direto para a atleta?",
    answer: "[Placeholder] Explicação de como os recursos chegam até a atleta.",
  },
  {
    question: "Posso doar anonimamente?",
    answer: 'Sim — basta não marcar a opção "Quero aparecer publicamente" no formulário.',
  },
  {
    question: "Quais formas de pagamento são aceitas?",
    answer:
      "Todas as disponíveis no Checkout Pro do Mercado Pago (cartão, Pix, boleto, conforme configuração).",
  },
  {
    question: "Recebo comprovante da doação?",
    answer: "O comprovante de pagamento é emitido pelo próprio Mercado Pago.",
  },
];

export function Faq() {
  return (
    <section className="px-4 py-16">
      <div className="mx-auto max-w-3xl">
        <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">Perguntas frequentes</h2>
        <div className="mt-6 divide-y divide-slate-200">
          {FAQ_ITEMS.map((item) => (
            <details key={item.question} className="group py-4">
              <summary className="focus-ring flex cursor-pointer list-none items-center justify-between font-medium text-slate-900">
                {item.question}
                <span
                  aria-hidden
                  className="ml-4 text-slate-400 transition-transform group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="mt-2 text-sm text-slate-600">{item.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

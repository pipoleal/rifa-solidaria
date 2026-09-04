export function Story({ story }: { story: string }) {
  return (
    <section className="px-4 py-16">
      <div className="mx-auto max-w-3xl">
        <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">A história</h2>
        <p className="mt-4 leading-relaxed whitespace-pre-line text-slate-700">{story}</p>
      </div>
    </section>
  );
}

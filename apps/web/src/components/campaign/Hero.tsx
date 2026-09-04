import type { CampaignResponse } from "@solidaria/shared";

export function Hero({ campaign }: { campaign: CampaignResponse }) {
  const summary = campaign.story.length > 160 ? `${campaign.story.slice(0, 160)}…` : campaign.story;

  return (
    <section className="bg-gradient-to-b from-emerald-50 to-white px-4 py-16 text-center sm:py-24">
      <div className="mx-auto max-w-3xl">
        <p className="text-sm font-semibold tracking-wide text-emerald-700 uppercase">
          Campanha solidária
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-5xl">
          {campaign.title}
        </h1>
        <p className="mt-4 text-lg text-slate-600">{summary}</p>
        <a
          href="#doar"
          className="focus-ring mt-8 inline-block rounded-full bg-emerald-600 px-8 py-3 text-base font-semibold text-white transition hover:bg-emerald-700"
        >
          Quero ajudar
        </a>
      </div>
    </section>
  );
}

import { Faq } from "@/components/campaign/Faq";
import { Goal } from "@/components/campaign/Goal";
import { Hero } from "@/components/campaign/Hero";
import { HowToHelp } from "@/components/campaign/HowToHelp";
import { Story } from "@/components/campaign/Story";
import { Transparency } from "@/components/campaign/Transparency";
import { DonationForm } from "@/components/donation/DonationForm";
import { Footer } from "@/components/layout/Footer";
import { getCampaign } from "@/lib/api";

export default async function HomePage() {
  let campaign;
  try {
    campaign = await getCampaign();
  } catch {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 text-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Não foi possível carregar a campanha
          </h1>
          <p className="mt-2 text-slate-600">Tente novamente em instantes.</p>
        </div>
      </main>
    );
  }

  if (!campaign) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 text-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Nenhuma campanha ativa no momento</h1>
          <p className="mt-2 text-slate-600">Volte em breve para conhecer a campanha.</p>
        </div>
      </main>
    );
  }

  return (
    <main>
      <Hero campaign={campaign} />
      <Story story={campaign.story} />
      <Goal currentAmount={campaign.currentAmount} goalAmount={campaign.goalAmount} />
      <HowToHelp />
      <DonationForm campaignId={campaign.id} />
      <Transparency />
      <Faq />
      <Footer />
    </main>
  );
}

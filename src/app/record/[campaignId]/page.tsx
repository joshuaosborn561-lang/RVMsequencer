import { notFound, unauthorized } from "next/navigation";
import { CampaignRecorder } from "@/components/campaign-recorder";
import { getCampaign } from "@/lib/store/db";
import { verifyRecorderToken } from "@/lib/security/recorder-link";

type PageProps = {
  params: Promise<{ campaignId: string }>;
  searchParams: Promise<{ t?: string }>;
};

function renderScriptPlaceholders(script: string): string {
  return script.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
    const label = key.replace(/[._]/g, " ").toUpperCase();
    return `[${label}]`;
  });
}

export default async function RecordCampaignPage(props: PageProps) {
  const { campaignId } = await props.params;
  const { t: token } = await props.searchParams;

  const auth = verifyRecorderToken(campaignId, token);
  if (!auth.ok) {
    unauthorized();
  }

  const campaign = await getCampaign(campaignId);
  if (!campaign) {
    notFound();
  }

  const step1 =
    campaign.steps.find((s) => s.position === 1) ?? campaign.steps[0];
  const scriptDisplay = renderScriptPlaceholders(step1?.scriptTemplate ?? "");

  return (
    <main className="min-h-full bg-[var(--bg)] px-4">
      <CampaignRecorder
        campaignId={campaign.id}
        token={token!}
        campaignName={campaign.name}
        scriptDisplay={scriptDisplay}
        existingAudioUrl={campaign.audioUrl ?? step1?.audioUrl ?? null}
      />
    </main>
  );
}

export default function RecordCampaignNotFound() {
  return (
    <main className="mx-auto max-w-lg px-4 py-16 text-center">
      <h1 className="font-[family-name:var(--font-display)] text-2xl text-[var(--ink)]">
        Campaign not found
      </h1>
      <p className="mt-3 text-sm text-[var(--muted)]">
        This recording link points at a campaign that does not exist.
      </p>
    </main>
  );
}

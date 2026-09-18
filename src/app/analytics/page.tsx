import { getSuppressionFanoutStatus } from "@/lib/suppression-fanout/engine";
import { AnalyticsClient } from "./analytics-client";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const fanout = await getSuppressionFanoutStatus();
  return (
    <AnalyticsClient
      fanout={{
        lastRunAt: fanout.lastRunAt,
        outcomes: fanout.outcomes,
        destinations: fanout.destinations,
        retrying: fanout.retrying,
        errors: fanout.errors,
        alloDoNotCallTagPresent: fanout.alloDoNotCallTagPresent,
      }}
    />
  );
}

import { MonitorCard, SourceRunsCard } from "./monitor-sources";
import type { useMonitorSetup } from "./use-monitor-setup";

/** Source runs and monitor configuration as one stack. */
export function MonitorConfigCard({ setup }: { setup: ReturnType<typeof useMonitorSetup> }) {
  return (
    <>
      <SourceRunsCard setup={setup} />
      <MonitorCard setup={setup} />
    </>
  );
}

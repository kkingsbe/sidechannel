import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useCommand } from "../../components/use-command";
import { useClients } from "../../lib/clients/context";
import { useResourceOffsetPage } from "../../lib/clients/query";
import type { Run } from "../../lib/types";
import type {
  MonitorPreview,
  MonitorSettings,
  Projection,
} from "@sidechannel/contracts/browser";
import { useMonitorDefinitionHistory } from "./use-monitor-definition";

/** Source-run selection, independent monitor settings, frozen preview and explicit launch. */
export function useMonitorSetup() {
  const clients = useClients();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const history = useMonitorDefinitionHistory();
  const runs = useResourceOffsetPage<Run>(
    "oversight:completed-runs",
    async (offset) => {
      const page = await clients.runs.list({
        summary: true,
        status: "completed",
        offset,
        limit: 25,
      });
      return {
        items: page.items,
        total: page.total ?? page.items.length,
        nextOffset: page.nextOffset ?? null,
      };
    },
    { pageSize: 25 },
  );
  const [selected, setSelected] = useState<string[]>(
    params.get("run") ? [params.get("run")!] : [],
  );
  const [definitionRevision, setDefinitionRevision] = useState(0);
  const [settings, setSettings] = useState<MonitorSettings>({
    model: { provider: "", id: "", settings: {} },
    maxInputChars: 100000,
    contextWindowTokens: 32768,
    outputAllowanceTokens: 2048,
    timeoutMs: 120000,
  });
  const [preview, setPreview] = useState<MonitorPreview>();
  const [projection, setProjection] = useState<Projection>();
  const command = useCommand();
  const launchKey = useRef(crypto.randomUUID());
  useEffect(() => {
    if (!definitionRevision && history.items[0])
      setDefinitionRevision(history.items[0].revision);
  }, [history.items, definitionRevision]);
  const change = (patch: Partial<MonitorSettings>) => {
    setSettings((old) => ({ ...old, ...patch }));
    setPreview(undefined);
    launchKey.current = crypto.randomUUID();
  };
  const selectRun = (id: string, checked: boolean) => {
    setSelected((previous) =>
      checked ? [...previous, id] : previous.filter((value) => value !== id),
    );
    setPreview(undefined);
  };
  const removeRun = (id: string) => {
    setSelected((previous) => previous.filter((value) => value !== id));
    setPreview(undefined);
  };
  const selectDefinitionRevision = (revision: number) => {
    setDefinitionRevision(revision);
    setPreview(undefined);
  };
  const prerequisites = [
    !selected.length && "Select at least one completed source run.",
    !settings.model.provider.trim() && "Enter a monitor provider.",
    !settings.model.id.trim() && "Enter a monitor model.",
    !definitionRevision && "Select a definition revision.",
    ![
      settings.contextWindowTokens,
      settings.outputAllowanceTokens,
      settings.maxInputChars,
      settings.timeoutMs,
    ].every((value) => Number.isFinite(value) && value > 0) &&
      "Use positive values for all input limits and timeout.",
  ].filter(Boolean) as string[];
  const doPreview = async () => {
    const result = await command.run(() =>
      clients.monitor.preview({
        runIds: selected,
        definitionRevision,
        ...settings,
      }),
    );
    if (result) setPreview(result);
  };
  const launch = async () => {
    if (!preview) return;
    const result = await command.run(() =>
      clients.monitor.launch({
        previewId: preview.id,
        previewHash: preview.hash,
        idempotencyKey: launchKey.current,
      }),
    );
    if (result) navigate("/oversight/" + result.id);
  };
  return {
    history,
    runs,
    selected,
    selectRun,
    removeRun,
    definitionRevision,
    selectDefinitionRevision,
    settings,
    change,
    preview,
    projection,
    setProjection,
    command,
    prerequisites,
    doPreview,
    launch,
  };
}

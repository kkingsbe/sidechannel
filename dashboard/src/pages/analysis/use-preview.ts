import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCommand } from "../../components/use-command";
import { useClients } from "../../lib/clients/context";
import type { AnalysisPreview, AnalysisSettings } from "../../lib/analysis-types";

/**
 * Preview preparation and launch. Staleness is decided by settings identity: a response is
 * accepted only when the settings object captured at request time is still the current one.
 */
export function usePreview(input: { runId: string; settings: AnalysisSettings }) {
  const clients = useClients();
  const navigate = useNavigate();
  const command = useCommand();
  const [preview, setPreview] = useState<AnalysisPreview>();
  const [previewWindow, setPreviewWindow] = useState<
    AnalysisPreview["windows"][number] & { state?: string }
  >();
  const latest = useRef(input.settings);
  latest.current = input.settings;
  const clear = () => setPreview(undefined);
  useEffect(() => {
    setPreview(undefined);
  }, [input.runId]);
  const prepare = async () => {
    if (!input.runId) return;
    const request = input.settings;
    setPreview(undefined);
    const result = await command.run(() =>
      clients.analyses.preview(input.runId, request),
    );
    if (result && latest.current === request) setPreview(result);
  };
  const launch = async () => {
    if (!preview) return;
    const result = await command.run(() =>
      clients.analyses.launch(input.runId, input.settings, preview.previewToken),
    );
    if (result) navigate("/analysis/" + result.id);
  };
  const scoreable =
    preview?.windows.filter(
      (w) => !w.budget.oversized && !w.empty && w.budget.batches.length > 0,
    ).length ?? 0;
  return {
    preview,
    previewWindow,
    setPreviewWindow,
    clear,
    prepare,
    launch,
    scoreable,
    busy: command.busy,
    error: command.error,
    message: command.message,
  };
}

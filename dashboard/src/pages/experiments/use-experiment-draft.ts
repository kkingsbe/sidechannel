import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCommand } from "../../components/use-command";
import { useClients } from "../../lib/clients/context";
import { useResource } from "../../lib/clients/query";
import type { Draft, ExperimentConfig, Run } from "../../lib/types";
import {
  readSessionLaunches,
  recordSessionLaunch,
  type SessionLaunch,
} from "../../lib/experiment-form";
import { completeConfiguration, setAt } from "./config-edit";
import { buildLaunchPayload } from "./launch-payload";

export const LOCAL_DRAFT_KEY = "sidechannel-experiment-draft";

/**
 * The experiment draft: defaults/schema/draft-list reads, the persisted form state and the
 * save/duplicate/load/complete actions. One owner of `config`, `dirty` and the launch key.
 */
export function useExperimentDraft(source: {
  draftId: string | null;
  editing: boolean;
  recover: boolean;
  routeKey: string;
}) {
  const clients = useClients();
  const navigate = useNavigate();
  const defaults = useResource(
    source.editing ? "experiments:defaults" : null,
    () => clients.experiments.defaults(),
  );
  const schema = useResource(
    source.editing ? "experiments:schema" : null,
    () => clients.experiments.schema(),
  );
  const drafts = useResource(
    source.editing ? "experiments:drafts" : null,
    () => clients.experiments.drafts(),
  );
  const command = useCommand();
  const [config, setConfig] = useState<ExperimentConfig>();
  const [draft, setDraft] = useState<Draft>();
  const [draftError, setDraftError] = useState<Error>();
  const [dirty, setDirty] = useState(false);
  const [savedLocal, setSavedLocal] = useState(false);
  const [launched, setLaunched] = useState<Run[]>();
  const [launchedNow, setLaunchedNow] = useState<SessionLaunch>();
  const [sessionLaunches, setSessionLaunches] = useState(readSessionLaunches);
  const [notes, setNotes] = useState("");
  const launchKey = useRef(crypto.randomUUID());
  const initializedRoute = useRef("");
  const rotateLaunchKey = () => {
    launchKey.current = crypto.randomUUID();
  };
  useEffect(() => {
    if (!defaults.data || !source.editing) return;
    if (initializedRoute.current === source.routeKey) return;
    initializedRoute.current = source.routeKey;
    if (source.draftId) return;
    setDraft(undefined);
    setNotes("");
    setDirty(false);
    setSavedLocal(false);
    setDraftError(undefined);
    rotateLaunchKey();
    const saved = localStorage.getItem(LOCAL_DRAFT_KEY);
    if (saved && source.recover && !source.draftId) {
      try {
        const data = JSON.parse(saved);
        setConfig(data.config);
        setDraft(data.draft);
        setNotes((data as Draft & { notes?: string }).notes || "");
        setSavedLocal(true);
        setDirty(true);
        return;
      } catch {
        /* Ignore an invalid local recovery copy. */
      }
    }
    setConfig(structuredClone(defaults.data));
  }, [defaults.data, source.editing, source.recover, source.draftId, source.routeKey]);
  useEffect(() => {
    if (!source.draftId) return;
    setDraftError(undefined);
    void clients.experiments
      .draft(source.draftId)
      .then((data) => {
        setConfig(data.config);
        setDraft(data);
        setNotes((data as Draft & { notes?: string }).notes || "");
        setSavedLocal(false);
        setDirty(false);
      })
      .catch((error: Error) => setDraftError(error));
  }, [clients, source.draftId]);
  useEffect(() => {
    if (config && dirty)
      localStorage.setItem(
        LOCAL_DRAFT_KEY,
        JSON.stringify({ config, draft, notes }),
      );
  }, [config, draft, dirty, notes]);
  const change = (path: string, value: unknown) => {
    if (!config) return;
    setConfig(setAt(config, path, value));
    setDirty(true);
    rotateLaunchKey();
  };
  const replace = (value: ExperimentConfig) => {
    setConfig(value);
    setDirty(true);
    rotateLaunchKey();
  };
  const editNotes = (value: string) => {
    setNotes(value);
    setDirty(true);
    rotateLaunchKey();
  };
  const saved = (revision: Draft) => {
    setDraft(revision);
    rotateLaunchKey();
    setDirty(false);
    setSavedLocal(false);
    localStorage.removeItem(LOCAL_DRAFT_KEY);
    void drafts.refresh();
  };
  const save = async () => {
    const result = await command.run(
      () =>
        clients.experiments.saveDraft({
          id: draft?.id,
          revision: draft?.revision,
          config: config!,
          name: config?.label,
          notes,
        }),
      "Draft saved. This does not launch any run.",
    );
    if (result) saved(result);
  };
  const complete = () => {
    if (!defaults.data || !config) return;
    setConfig(completeConfiguration(defaults.data, config));
    setDirty(true);
    rotateLaunchKey();
  };
  const startNew = () => {
    if (defaults.data) setConfig(structuredClone(defaults.data));
    setDraft(undefined);
    setDirty(false);
    setLaunchedNow(undefined);
    rotateLaunchKey();
    navigate("/experiments/new");
  };
  /** "Save as new": keep the current configuration but detach the loaded draft identity. */
  const saveAsNew = () => {
    setDraft(undefined);
    setDirty(true);
  };
  const load = (item: Draft) => {
    if (
      dirty &&
      !window.confirm(
        "Replace unsaved edits with this saved draft? A local recovery copy is available until the next edit.",
      )
    )
      return;
    setConfig(structuredClone(item.config));
    setDraft(item);
    setNotes((item as Draft & { notes?: string }).notes || "");
    setDirty(false);
    setSavedLocal(false);
    rotateLaunchKey();
    navigate("/experiments?draft=" + item.id);
  };
  const duplicate = async () => {
    if (!draft) return;
    const result = await command.run(() =>
      clients.experiments.duplicateDraft(draft.id),
    );
    if (result) {
      setConfig(result.config);
      setDraft(result);
      rotateLaunchKey();
      setDirty(false);
      void drafts.refresh();
    }
  };
  const launch = async (): Promise<Run[] | undefined> => {
    if (!config) return undefined;
    const result = await command.run(() =>
      clients.experiments.launchPair(
        buildLaunchPayload({
          config,
          launchKey: launchKey.current,
          dirty,
          draft,
        }),
      ),
    );
    if (result) {
      setLaunched(result);
      const entries = recordSessionLaunch(config, launchKey.current, result);
      setSessionLaunches(entries);
      setLaunchedNow(entries[0]);
      localStorage.removeItem(LOCAL_DRAFT_KEY);
    }
    return result;
  };
  return {
    config,
    draft,
    notes,
    dirty,
    savedLocal,
    launched,
    launchedNow,
    sessionLaunches,
    draftError,
    launchKey: launchKey.current,
    defaults,
    schema,
    drafts,
    command,
    change,
    replace,
    editNotes,
    saved,
    save,
    complete,
    startNew,
    saveAsNew,
    load,
    duplicate,
    launch,
    rotateLaunchKey,
  };
}

export type ExperimentDraft = ReturnType<typeof useExperimentDraft>;

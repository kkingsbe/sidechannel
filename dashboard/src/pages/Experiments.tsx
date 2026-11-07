import { Link, useLocation, useSearchParams } from "react-router-dom";
import { ErrorState, Loading } from "../components/ui";
import { isEditableConfiguration } from "./experiments/config-edit";
import { DraftLibrary } from "./experiments/draft-library";
import { ExperimentEditor } from "./experiments/experiment-editor";
import { IncompleteDraft } from "./experiments/incomplete-draft";
import { LOCAL_DRAFT_KEY, useExperimentDraft } from "./experiments/use-experiment-draft";
import { useExperimentValidation } from "./experiments/use-experiment-validation";
import "./experiments/experiments.css";

/** Route shell: reads route identity and hands it to the draft/validation hooks. */
export default function Experiments() {
  const [params] = useSearchParams();
  const location = useLocation();
  const draftId = params.get("draft");
  const recover = params.has("recover");
  const editing =
    location.pathname.endsWith("/new") || draftId !== null || recover;
  const localRecovery = localStorage.getItem(LOCAL_DRAFT_KEY);
  const draft = useExperimentDraft({
    draftId,
    editing,
    recover,
    routeKey: location.pathname + location.search,
  });
  const validation = useExperimentValidation({
    config: draft.config,
    onAccepted: draft.replace,
    invalidateOn: draft.config,
  });
  if (!editing) return <DraftLibrary localRecovery={localRecovery} />;
  if (draft.draftError)
    return (
      <>
        <Link to="/experiments">All experiments</Link>
        <ErrorState error={draft.draftError} />
      </>
    );
  if (draft.defaults.loading || (!draft.config && !draft.defaults.error))
    return <Loading />;
  if (!draft.config)
    return <ErrorState error={draft.defaults.error} retry={draft.defaults.refresh} />;
  if (!isEditableConfiguration(draft.config))
    return (
      <IncompleteDraft
        config={draft.config}
        draft={draft.draft}
        busy={draft.command.busy}
        error={draft.command.error}
        onChange={draft.change}
        onComplete={draft.complete}
        onSave={() => void draft.save()}
        onStartNew={draft.startNew}
      />
    );
  return <ExperimentEditor draft={draft} validation={validation} />;
}

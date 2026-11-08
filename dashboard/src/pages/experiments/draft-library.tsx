import { Link } from "react-router-dom";
import { Copy, Plus } from "lucide-react";
import {
  Button,
  Card,
  CardHeading,
  ErrorState,
  Loading,
  PageHeader,
} from "../../components/ui";
import { useClients } from "../../lib/clients/context";
import { useResource, type Resource } from "../../lib/clients/query";
import type { Draft } from "../../lib/types";
import { when } from "../../lib/utils";

/** The shared-draft collection shown at `/experiments`; owns its own drafts read. */
export function DraftLibrary({ localRecovery }: { localRecovery: string | null }) {
  const clients = useClients();
  const drafts = useResource("experiments:drafts:library", () =>
    clients.experiments.drafts(),
  );
  return (
    <>
      <PageHeader
        title="Experiments"
        description="Resume a shared configuration or create a matched pair."
        actions={
          <Button asChild>
            <Link to="/experiments/new">
              <Plus size={15} />
              New experiment
            </Link>
          </Button>
        }
      />
      {localRecovery && (
        <Card>
          <CardHeading
            title="Local recovery"
            description="Unsaved edits in this browser only. Shared drafts are listed separately."
          />
          <div className="card-body">
            <Button asChild variant="secondary">
              <Link to="/experiments/new?recover=1">Recover local edits</Link>
            </Button>
          </div>
        </Card>
      )}
      <Card>
        <CardHeading
          title="Shared saved drafts"
          description="Saved configurations available to collaborators; saving does not launch runs."
        />
        {drafts.loading ? (
          <Loading />
        ) : drafts.error ? (
          <ErrorState error={drafts.error} retry={drafts.refresh} />
        ) : drafts.data?.length ? (
          drafts.data.map((item) => (
            <Link
              className="list-button"
              key={item.id}
              to={"/experiments?draft=" + encodeURIComponent(item.id)}
            >
              <div>
                <strong>{item.config?.label || item.id}</strong>
                <small>
                  {when(item.updatedAt)} · revision {item.revision ?? 1}
                </small>
              </div>
            </Link>
          ))
        ) : (
          <p className="card-body">
            No shared drafts yet. Create an experiment to begin.
          </p>
        )}
      </Card>
    </>
  );
}

/** The editor-aside saved-draft card: selectable rows plus the duplicate/save-as-new actions. */
export function DraftListCard({
  drafts,
  current,
  onLoad,
  onDuplicate,
  onNew,
  onStartNew,
}: {
  drafts: Resource<Draft[]>;
  current: Draft | undefined;
  onLoad(item: Draft): void;
  onDuplicate(): void;
  onNew(): void;
  onStartNew(): void;
}) {
  return (
    <Card>
      <CardHeading
        title="Saved drafts"
        actions={
          <Button
            aria-label="Start a new draft"
            size="icon"
            variant="ghost"
            onClick={onStartNew}
          >
            <Plus size={16} />
          </Button>
        }
      />
      {drafts.loading ? (
        <Loading />
      ) : drafts.error ? (
        <ErrorState error={drafts.error} retry={drafts.refresh} />
      ) : drafts.data?.length ? (
        drafts.data.map((item) => (
          <button
            className={
              "list-button " + (current?.id === item.id ? "selected" : "")
            }
            key={item.id}
            onClick={() => onLoad(item)}
          >
            <div>
              <strong>{item.config?.label || item.id}</strong>
              <small>
                {when(item.updatedAt)} · r{item.revision ?? 1}
              </small>
            </div>
          </button>
        ))
      ) : (
        <p className="helper card-body">
          Save your configuration to share a draft.
        </p>
      )}
      {current && (
        <div className="card-body actions" style={{ paddingTop: 15 }}>
          <Button size="sm" variant="secondary" onClick={onDuplicate}>
            <Copy size={13} />
            Duplicate draft
          </Button>
          <Button size="sm" variant="ghost" onClick={onNew}>
            Save as new
          </Button>
        </div>
      )}
    </Card>
  );
}

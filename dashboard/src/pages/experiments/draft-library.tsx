import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import {
  Button,
  Card,
  CardHeading,
  Empty,
  ErrorState,
  Loading,
  Notice,
  PageHeader,
} from "../../components/ui";
import { LaunchedExperiments, useLaunchedExperiments } from "../../components/pairs/LaunchedExperiments";
import { useClients } from "../../lib/clients/context";
import { useResource } from "../../lib/clients/query";
import { when } from "../../lib/utils";
import { isEditableConfiguration } from "./config-edit";

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** The experiments list at `/experiments`: saved drafts, then launched experiments. */
export function DraftLibrary({ localRecovery }: { localRecovery: string | null }) {
  const clients = useClients();
  const drafts = useResource("experiments:drafts:library", () =>
    clients.experiments.drafts(),
  );
  const launched = useLaunchedExperiments();
  const ready = !!drafts.data && !!launched.resource.data;
  return (
    <>
      <PageHeader
        title="Experiments"
        description={
          ready ? (
            <>
              <strong>{plural(drafts.data!.length, "saved draft")}</strong> ·{" "}
              {plural(launched.groups.length, "launched experiment")} ·{" "}
              {plural(launched.runCount, "run")}
            </>
          ) : (
            "Saved drafts and launched experiments."
          )
        }
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
        <Notice>
          Unsaved edits are stored in this browser only.{" "}
          <Link to="/experiments/new?recover=1">Recover local edits</Link>
        </Notice>
      )}
      <Card>
        <CardHeading
          title="Saved drafts"
          count={drafts.data?.length || undefined}
          description="Shared with collaborators; saving a draft never launches runs."
        />
        {drafts.loading ? (
          <Loading />
        ) : drafts.error ? (
          <ErrorState error={drafts.error} retry={drafts.refresh} />
        ) : drafts.data?.length ? (
          drafts.data.map((item) => {
            const incomplete = !item.config || !isEditableConfiguration(item.config);
            const group = item.config?.experimentId;
            return (
              <Link
                className="trow"
                style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}
                key={item.id}
                to={"/experiments?draft=" + encodeURIComponent(item.id)}
              >
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontWeight: 500 }}>
                    {item.config?.label || item.id}
                  </span>
                  <span className="small muted">
                    {when(item.updatedAt)}
                    {group ? ` · ${group}` : ""} · revision {item.revision ?? 1}
                    {incomplete ? " · incomplete" : ""}
                  </span>
                </span>
                <span className="link">Resume</span>
              </Link>
            );
          })
        ) : (
          <Empty
            title="No saved drafts"
            description="Open New experiment and choose Save draft to keep a configuration here."
          />
        )}
      </Card>
      <LaunchedExperiments data={launched} />
    </>
  );
}

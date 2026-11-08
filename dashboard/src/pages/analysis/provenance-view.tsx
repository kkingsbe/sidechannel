import { useParams } from "react-router-dom";
import { Download } from "lucide-react";
import { Button, Card, CardHeading, ErrorState, JsonView, Loading } from "../../components/ui";
import { useClients } from "../../lib/clients/context";
import { useAnalysisJob } from "./use-analysis-job";

/** Frozen provenance and the complete-export anchors. */
export function ProvenanceView() {
  const { id } = useParams();
  const clients = useClients();
  const job = useAnalysisJob(id);
  if (job.loading) return <Loading />;
  if (!job.job) return <ErrorState error={job.error} retry={job.refresh} />;
  const data = job.job;
  const m = data.manifest;
  return (
    <div className="g12 an-equal">
      <Card className="c7">
        <CardHeading
          ruled
          title="Reproducible provenance"
          description="Frozen configuration, evidence boundaries and versions."
        />
        <div className="card-body an-body">
          <dl className="kv">
            <dt>Source completeness</dt>
            <dd>{m.sourceStatus}</dd>
            <dt>Evidence hash</dt>
            <dd className="mono">{m.evidenceHash}</dd>
            <dt>Settings hash</dt>
            <dd className="mono">{m.settingsHash || m.configHash}</dd>
            <dt>Normalizer</dt>
            <dd className="mono">{m.normalizerVersion}</dd>
            <dt>SDK</dt>
            <dd className="mono">{m.sdkVersion}</dd>
            <dt>Adapter</dt>
            <dd className="mono">{m.adapterVersion}</dd>
            <dt>Source boundary</dt>
            <dd>event {m.sequenceBoundary}</dd>
          </dl>
        </div>
      </Card>
      <Card className="c5">
        <CardHeading
          ruled
          title="Export"
          description="Every frozen source, input, score, attempt and review record as separate linked record types."
        />
        <div className="card-body an-body">
          <Button asChild variant="secondary">
            <a href={clients.analyses.datasetExportUrl(id!, "analysis")} download>
              <Download size={14} />
              Download linked datasets (NDJSON)
            </a>
          </Button>
        </div>
      </Card>
      <div className="c12">
        <JsonView value={m} title="Complete frozen analysis manifest" />
      </div>
    </div>
  );
}

import { useParams } from "react-router-dom";
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
  return (
    <Card>
      <CardHeading
        title="Reproducible provenance"
        description="Frozen configuration, evidence boundaries, definitions, and missingness."
      />
      <div className="card-body">
        <dl className="definition-list">
          <dt>Source completeness</dt>
          <dd>{data.manifest.sourceStatus}</dd>
          <dt>Evidence hash</dt>
          <dd className="mono">{data.manifest.evidenceHash}</dd>
          <dt>Normalizer</dt>
          <dd>{data.manifest.normalizerVersion}</dd>
          <dt>SDK / adapter</dt>
          <dd>
            {data.manifest.sdkVersion} / {data.manifest.adapterVersion}
          </dd>
        </dl>
        <hr className="section-divider" />
        <div className="actions">
          {["analysis"].map((dataset) => (
            <Button key={dataset} asChild variant="secondary" size="sm">
              <a href={clients.analyses.datasetExportUrl(id!, dataset)} download>
                Complete linked datasets
              </a>
            </Button>
          ))}
        </div>
        <p className="helper" style={{ margin: "12px 0" }}>
          The NDJSON export streams the complete frozen source, inputs, scores,
          attempts, and review provenance as separate linked record types.
        </p>
        <JsonView
          value={data.manifest}
          title="Complete frozen analysis manifest"
        />
      </div>
    </Card>
  );
}

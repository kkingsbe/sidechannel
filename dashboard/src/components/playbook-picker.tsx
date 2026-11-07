import type { PlaybookCatalogItem } from "@sidechannel/contracts/browser";
import type { ExperimentConfig } from "../lib/types";
import { post, useApi, useMutation } from "../lib/api";
import { Button, Field, Loading, Notice, Select } from "./ui";

const key = (
  item: Pick<PlaybookCatalogItem, "playbookId" | "playbookVersion">,
) => `${item.playbookId}:${item.playbookVersion}`;

const readText = (file: File): Promise<string> =>
  typeof file.text === "function"
    ? file.text()
    : new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
      });

export function PlaybookPicker({
  config,
  replace,
  errors,
}: {
  config: ExperimentConfig;
  replace: (config: ExperimentConfig) => void;
  errors?: Record<string, string>;
}) {
  const catalog = useApi<PlaybookCatalogItem[]>("/playbooks");
  const mutation = useMutation();
  const parseFailure = useMutation();
  const version = config.model.settings.playbookVersion;
  const selected =
    config.model.id && typeof version === "string"
      ? catalog.data?.find(
          (item) =>
            item.playbookId === config.model.id &&
            item.playbookVersion === version,
        )
      : undefined;
  const select = (item: PlaybookCatalogItem) => {
    // The server embeds playbook/playbookHash; never carry stale content across selections.
    const settings = { ...config.model.settings };
    delete settings.playbook;
    delete settings.playbookHash;
    replace({
      ...config,
      phase: "development",
      model: {
        ...config.model,
        provider: "playbook",
        id: item.playbookId,
        settings: { ...settings, playbookVersion: item.playbookVersion },
      },
    });
  };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    mutation.clear();
    parseFailure.clear();
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readText(file));
    } catch (error) {
      await parseFailure.run(() =>
        Promise.reject(
          new Error(
            `${file.name} is not valid JSON: ${(error as Error).message}`,
          ),
        ),
      );
      return;
    }
    const item = await mutation.run(() =>
      post<PlaybookCatalogItem>("/playbooks", parsed),
    );
    if (!item) return;
    void catalog.refresh();
    select(item);
  };
  const roleIds = config.roles.map((role) => role.id).sort();
  const rolesMatch =
    !!selected &&
    selected.roles.length === roleIds.length &&
    [...selected.roles].sort().every((id, index) => id === roleIds[index]);
  return (
    <div className="full stack">
      {catalog.loading ? (
        <Loading />
      ) : catalog.error ? (
        <Notice kind="warning">
          Playbook catalog unavailable: {catalog.error.message}{" "}
          <Button variant="ghost" onClick={catalog.refresh}>
            Retry catalog
          </Button>
        </Notice>
      ) : (
        <Field
          label="Registered playbook"
          error={
            errors?.["model.id"] ?? errors?.["model.settings.playbookVersion"]
          }
          hint="Playbooks are immutable once registered; selecting one fixes the id and version."
        >
          <Select
            data-config-path="model.id"
            value={selected ? key(selected) : ""}
            disabled={mutation.busy}
            onChange={(event) => {
              const item = catalog.data?.find(
                (entry) => key(entry) === event.target.value,
              );
              if (item) select(item);
            }}
          >
            <option value="">Select an uploaded playbook</option>
            {catalog.data?.map((item) => (
              <option
                key={key(item)}
                value={key(item)}
                disabled={item.scenarioVersion !== config.scenario.version}
              >
                {item.displayName} · v{item.playbookVersion} · {item.rounds}{" "}
                rounds
                {item.scenarioVersion !== config.scenario.version
                  ? " · different scenario"
                  : ""}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field
        label="Upload playbook JSON"
        hint="Registers the playbook on the server and selects it."
      >
        <input
          type="file"
          accept="application/json,.json"
          disabled={mutation.busy}
          onChange={(event) => {
            const input = event.currentTarget;
            const file = input.files?.[0];
            void upload(file).finally(() => {
              input.value = "";
            });
          }}
        />
      </Field>
      {selected && (
        <dl className="helper">
          <dt>Roles</dt>
          <dd>{selected.roles.join(", ")}</dd>
          <dt>Rounds</dt>
          <dd>{selected.rounds}</dd>
          {selected.datasetId && (
            <>
              <dt>Dataset</dt>
              <dd>{selected.datasetId}</dd>
            </>
          )}
          <dt>Hash</dt>
          <dd>{selected.playbookHash.slice(0, 12)}</dd>
          <dt>Registered</dt>
          <dd>{new Date(selected.registeredAt).toLocaleDateString()}</dd>
        </dl>
      )}
      {selected && !rolesMatch && (
        <Notice kind="warning">
          This playbook&apos;s roles ({selected.roles.join(", ")}) do not match
          the configured roles ({roleIds.join(", ")}).
        </Notice>
      )}
      {selected && selected.rounds > config.scheduler.rounds && (
        <Notice kind="warning">
          This playbook scripts {selected.rounds} rounds but the scheduler runs{" "}
          {config.scheduler.rounds}.
        </Notice>
      )}
      {errors?.["model.settings.playbook"] && (
        <Notice kind="error">{errors["model.settings.playbook"]}</Notice>
      )}
      {errors?.phase && <Notice kind="error">{errors.phase}</Notice>}
      {parseFailure.error && (
        <Notice kind="error">{parseFailure.error.message}</Notice>
      )}
      {mutation.error && <Notice kind="error">{mutation.error.message}</Notice>}
    </div>
  );
}

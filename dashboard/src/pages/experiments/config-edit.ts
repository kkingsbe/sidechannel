import type { ExperimentConfig, Json } from "../../lib/types";

export const readableName = (value: string) =>
  value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^./, (letter) => letter.toUpperCase());

export const focusField = (path: string) => {
  const control = document.querySelector<HTMLElement>(
    `[data-config-path="${path}"]`,
  );
  let parent = control?.parentElement;
  while (parent) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
    parent = parent.parentElement;
  }
  control?.focus();
};

/** Structural gate only: it says the stored draft can be edited, not that it is valid. */
export function isEditableConfiguration(value: ExperimentConfig): boolean {
  return (
    [
      "model",
      "condition",
      "scenario",
      "scheduler",
      "board",
      "memory",
      "limits",
      "build",
    ].every(
      (key) =>
        value[key as keyof ExperimentConfig] &&
        typeof value[key as keyof ExperimentConfig] === "object",
    ) &&
    Array.isArray(value.roles) &&
    value.roles.every(
      (role) =>
        role != null &&
        typeof role.id === "string" &&
        typeof role.instructions === "string" &&
        Array.isArray(role.allowedTools),
    ) &&
    value.model.settings != null
  );
}

export function completeConfiguration(
  defaults: ExperimentConfig,
  input: unknown,
): ExperimentConfig {
  const merge = (base: unknown, value: unknown): unknown => {
    if (Array.isArray(base))
      return Array.isArray(value)
        ? value.map((item) => (base.length ? merge(base[0], item) : item))
        : structuredClone(base);
    if (base && typeof base === "object" && !Array.isArray(base)) {
      const object =
        value && typeof value === "object" && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : {};
      return {
        ...object,
        ...Object.fromEntries(
          Object.entries(base).map(([key, child]) => [
            key,
            merge(child, object[key]),
          ]),
        ),
      };
    }
    return value === undefined || value === null
      ? structuredClone(base)
      : value;
  };
  return merge(defaults, input) as ExperimentConfig;
}

export function valueAt(config: ExperimentConfig, path: string): unknown {
  return path
    .split(".")
    .reduce(
      (value: unknown, key) => (value as Record<string, unknown>)?.[key],
      config,
    );
}

export function setAt(
  config: ExperimentConfig,
  path: string,
  value: unknown,
): ExperimentConfig {
  const next = structuredClone(config);
  const keys = path.split(".");
  const last = keys.pop()!;
  const object = keys.reduce(
    (value: unknown, key) => (value as Record<string, unknown>)[key],
    next,
  ) as Record<string, unknown>;
  object[last] = value;
  return next;
}

export type PrimitiveAssets = [string, Json][] | null;

/** The editable primitive scenario-asset entries, or null when assets are structured. */
export function primitiveAssets(config: ExperimentConfig): PrimitiveAssets {
  const assets = config.scenario.assets;
  return assets && typeof assets === "object" && !Array.isArray(assets)
    ? Object.entries(assets)
    : null;
}

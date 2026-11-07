import type { Run } from "../../lib/types";

export function settingLabel(path: string) {
  const labels: Record<string, string> = {
    "condition.id": "Condition identifier",
    "condition.text": "Exact condition wording",
  };
  return (
    labels[path] ||
    path
      .split(".")
      .map((part) => part.replace(/([A-Z])/g, " $1"))
      .join(" / ")
  );
}

export function configValue(config: Run["config"], path: string) {
  const value = path
    .split(".")
    .reduce<unknown>(
      (current, key) =>
        current && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined,
      config,
    );
  return value === undefined ? "Not recorded" : typeof value === "string" ? value : JSON.stringify(value);
}

import { useEffect, useRef, useState, type ReactElement } from "react";
import { Field, Input, Textarea } from "../../components/ui";
import type { ExperimentConfig } from "../../lib/types";
import { valueAt } from "./config-edit";

export interface ConfigFieldFactory {
  (
    path: string,
    label: string,
    hint?: string,
    kind?: "text" | "textarea" | "number",
    min?: number,
  ): ReactElement;
}

export interface DurationFieldFactory {
  (path: string, label: string, scale: number): ReactElement;
}

/**
 * The single field factory: one place that renders a `data-config-path` control bound to a
 * config path, so no section re-implements the error/required/step wiring.
 */
export function useConfigField(
  config: ExperimentConfig,
  errors: Record<string, string> | undefined,
  required: (path: string) => boolean,
  change: (path: string, value: unknown) => void,
): { field: ConfigFieldFactory; duration: DurationFieldFactory } {
  const field: ConfigFieldFactory = (path, label, hint, kind = "text", min) => (
    <Field
      key={path}
      label={label}
      hint={hint}
      error={errors?.[path]}
      required={required(path)}
    >
      {kind === "textarea" ? (
        <Textarea
          data-config-path={path}
          value={String(valueAt(config, path) ?? "")}
          onChange={(e) => change(path, e.target.value)}
        />
      ) : (
        <Input
          data-config-path={path}
          type={kind}
          min={min}
          step={kind === "number" ? 1 : undefined}
          value={String(valueAt(config, path) ?? "")}
          onChange={(e) =>
            change(
              path,
              kind === "number" ? e.target.valueAsNumber : e.target.value,
            )
          }
        />
      )}
    </Field>
  );
  const duration: DurationFieldFactory = (path, label, scale) => (
    <Field
      label={label}
      error={errors?.[path]}
      hint={`Stored in milliseconds (${String(valueAt(config, path))} ms).`}
    >
      <Input
        data-config-path={path}
        type="number"
        step="any"
        min={1 / scale}
        value={Number(valueAt(config, path)) / scale}
        onChange={(event) =>
          change(path, Math.round(event.target.valueAsNumber * scale))
        }
      />
    </Field>
  );
  return { field, duration };
}

import { useEffect, useRef, useState } from "react";
import { useCommand } from "../../components/use-command";
import { useClients } from "../../lib/clients/context";
import type { ExperimentConfig } from "../../lib/types";
import type { Validation } from "../../lib/clients/workspace";
import { humanizeError, localFieldErrors } from "../../lib/experiment-form";
import { focusField } from "./config-edit";

const normalize = (result: Validation): Validation => {
  const raw = result.fieldErrors ?? {};
  const rawMessages = new Set(Object.values(raw));
  const fieldErrors = Object.fromEntries(
    Object.entries(raw).map(([path, message]) => [path, humanizeError(message, path)]),
  );
  const shown = new Set(Object.values(fieldErrors));
  const errors = [
    ...new Set(
      (result.errors || [])
        .filter((error) => !rawMessages.has(error))
        .map((error) => humanizeError(error)),
    ),
  ].filter((error) => !shown.has(error));
  return { ...result, fieldErrors, errors };
};

/**
 * The server verdict is the only validity owner. `invalidateOn` is the config identity: any
 * edit drops the verdict, and the verdict accepted for the form's current config survives the
 * config replacement that validation itself performs.
 *
 * Wave-2 launch safety: obvious browser-determinable mistakes are reported locally first with
 * plain wording, and server messages are humanised before they reach the form.
 */
export function useExperimentValidation(input: {
  config: ExperimentConfig | undefined;
  onAccepted(config: ExperimentConfig): void;
  invalidateOn: unknown;
}) {
  const clients = useClients();
  const command = useCommand();
  const [result, setResult] = useState<Validation>();
  const [reviewing, setReviewing] = useState(false);
  const accepted = useRef<ExperimentConfig | undefined>(undefined);
  useEffect(() => {
    if (accepted.current && accepted.current === input.invalidateOn) return;
    setResult(undefined);
    setReviewing(false);
  }, [input.invalidateOn]);
  const validate = async (): Promise<Validation | undefined> => {
    if (!input.config) return undefined;
    const local = localFieldErrors(input.config);
    if (Object.keys(local).length) {
      const localResult: Validation = { valid: false, errors: [], fieldErrors: local };
      setResult(localResult);
      setReviewing(false);
      requestAnimationFrame(() => focusField(Object.keys(local)[0]!));
      return localResult;
    }
    const response = await command.run(() => clients.experiments.validate(input.config!));
    if (!response) return undefined;
    const next = normalize(response);
    setResult(next);
    if (next.valid) {
      if (next.config) {
        accepted.current = next.config;
        input.onAccepted(next.config);
      } else {
        accepted.current = input.config;
      }
      setReviewing(true);
    } else {
      setReviewing(false);
      const path = Object.keys(next.fieldErrors || {})[0];
      requestAnimationFrame(() =>
        path
          ? focusField(path)
          : document.getElementById("experiment-errors")?.focus(),
      );
    }
    return next;
  };
  return {
    result,
    reviewing,
    busy: command.busy,
    error: command.error,
    message: command.message,
    launchable: reviewing && result?.valid === true,
    validate,
    dismissReview: () => setReviewing(false),
  };
}

export type ExperimentValidation = ReturnType<typeof useExperimentValidation>;

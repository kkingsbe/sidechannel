import { useEffect, useRef, useState } from "react";
import { useCommand } from "../../components/use-command";
import { useClients } from "../../lib/clients/context";
import type { ExperimentConfig } from "../../lib/types";
import type { Validation } from "../../lib/clients/workspace";
import { focusField } from "./config-edit";

/**
 * The server verdict is the only validity owner. `invalidateOn` is the config identity: any
 * edit drops the verdict, and the verdict accepted for the form's current config survives the
 * config replacement that validation itself performs.
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
    const next = await command.run(() => clients.experiments.validate(input.config!));
    if (!next) return undefined;
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

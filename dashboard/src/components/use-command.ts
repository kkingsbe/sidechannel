import { useMutation } from "../lib/api";

/** Thin alias over the single mutation state machine in `lib/api.ts` (no second implementation). */
export function useCommand() {
  return useMutation();
}

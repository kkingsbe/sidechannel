import { useState } from "react";

export const REVIEWER_STORAGE_KEY = "sidechannel-reviewer";

/** One claimed-reviewer key, one reader/writer. Self-entered identity, unverified. */
export function useClaimedReviewer() {
  const [reviewer, setReviewer] = useState(
    () => localStorage.getItem(REVIEWER_STORAGE_KEY) || "",
  );
  const identifyReviewer = (value: string) => {
    setReviewer(value);
    localStorage.setItem(REVIEWER_STORAGE_KEY, value);
  };
  return { reviewer, identifyReviewer };
}

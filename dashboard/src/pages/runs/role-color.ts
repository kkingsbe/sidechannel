/** A role's stable identity colour: its name hashes to one of five hues, so it never changes between views. */
const HUES = 5;

export function roleHue(role: string | undefined): number {
  let hash = 0;
  for (const char of role ?? "") hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return (hash % HUES) + 1;
}

/** `style` for an element that uses `.who-chip` (reads `--c`). */
export function roleStyle(role: string | undefined): React.CSSProperties {
  return { ["--c" as string]: `var(--role-${roleHue(role)})` };
}

/** Two-letter label for tight places: clinical_records -> CR, pharmacy -> PH. */
export function roleAbbreviation(role: string): string {
  const words = role.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  const letters = words.length > 1 ? words.map((word) => word[0]).join("") : (words[0] ?? "").slice(0, 2);
  return letters.slice(0, 2).toUpperCase();
}

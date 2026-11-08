import "./identity-line.css";
import { useState } from "react";
import { Input } from "./ui";

/**
 * "Saving as <name> · change": the remembered claimed identity as a line of text. When nothing is
 * stored yet (or after "change") the name input shows inline instead; leaving it with a name
 * collapses it back to the line. The input keeps the caller's accessible name.
 */
export function IdentityLine({
  lead,
  value,
  onChange,
  inputLabel,
  hint,
}: {
  lead: string;
  value: string;
  onChange: (value: string) => void;
  inputLabel: string;
  hint?: string;
}) {
  const [editing, setEditing] = useState(() => !value.trim());
  if (editing)
    return (
      <span className="identity-line">
        <span>{lead}</span>
        <Input
          aria-label={inputLabel}
          className="identity-input"
          placeholder="Your name"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => { if (value.trim()) setEditing(false); }}
          onKeyDown={(e) => { if (e.key === "Enter" && value.trim()) setEditing(false); }}
        />
        {hint && <span className="faint">{hint}</span>}
      </span>
    );
  return (
    <span className="identity-line">
      {lead} <b>{value}</b> ·{" "}
      <button type="button" className="link-button" onClick={() => setEditing(true)}>change</button>
    </span>
  );
}

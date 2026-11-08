import type { CSSProperties, ReactNode } from "react";
import { roleColor } from "./evidence-model";

/** A role with its colour dot (the shared `.who-chip`), never wrapping inside the chip. */
export function RoleChip({
  role,
  children,
  strong,
  className,
}: {
  role?: string | null;
  children?: ReactNode;
  strong?: boolean;
  className?: string;
}) {
  return (
    <span
      className={"who-chip ev-chip" + (strong ? " ev-chip-strong" : "") + (className ? " " + className : "")}
      style={{ "--c": roleColor(role) } as CSSProperties}
    >
      {role ?? "system"}
      {children}
    </span>
  );
}

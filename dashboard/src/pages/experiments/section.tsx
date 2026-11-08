import type { CSSProperties, ReactNode } from "react";
import type { SectionState } from "./sections";

const dot = (color: string) => ({ "--c": color }) as CSSProperties;

/** One stacked editor section: heading, one-line description, status line, then the fields in a well. */
export function Section({
  state,
  description,
  children,
}: {
  state: SectionState;
  description: string;
  children: ReactNode;
}) {
  const count = state.left.length;
  return (
    <section className="exp-sec" id={state.id} aria-labelledby={state.id + "-title"}>
      <div>
        <h2 id={state.id + "-title"}>{state.title}</h2>
        <p className="sd">{description}</p>
        <p className="sd status">
          {count === 0 ? (
            <span className="who-chip" style={dot("var(--success-fg)")}>
              Complete
            </span>
          ) : (
            <>
              <span className="who-chip" style={dot("var(--amber)")}>
                {count} {count === 1 ? "field" : "fields"} left
              </span>
              {" · "}
              {state.left.join(", ")}
            </>
          )}
        </p>
      </div>
      <div className="well">{children}</div>
    </section>
  );
}

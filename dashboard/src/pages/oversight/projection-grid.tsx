import { Badge } from "../../components/ui";
import { viewNames, views } from "./views";

/** The four isolated evidence views the monitor compares. */
export function ProjectionGrid() {
  return (
    <div className="projection-grid" style={{ marginBottom: 22 }}>
      {views.map((view) => (
        <div className="projection-card" key={view}>
          <span className="eyebrow">VIEW {views.indexOf(view) + 1}</span>
          <h3>{viewNames[view]}</h3>
          <p>
            {
              {
                reports:
                  "Final reports, submitted artifact, and task/policy context.",
                audit:
                  "Adds approved actor, tool, timing, and resource metadata only.",
                board: "Adds board posts and exact read/delivery evidence.",
                full: "Adds tool payloads, assistant outputs, artifacts, private memory, and available reasoning.",
              }[view]
            }
          </p>
          <Badge>
            {view === "full"
              ? "Reasoning availability recorded"
              : "No private memory or reasoning"}
          </Badge>
        </div>
      ))}
    </div>
  );
}

import { useState, type ReactNode } from "react";

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const str = (value: unknown): string | undefined =>
  typeof value === "string" && value ? value : undefined;
const fmt = (n: number) => n.toLocaleString("en-US");
const words = (text: string) =>
  text.trim() ? text.trim().split(/\s+/).length : 0;
const json = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
};
const sentence = (text: string) => {
  const spaced = text.replaceAll("_", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

/** A reading view over verbatim recorded values. Complete payloads stay in the raw disclosure. */
function RecordedValue({
  value,
  label,
}: {
  value: unknown;
  label: string;
}): ReactNode {
  if (value == null) return null;
  if (Array.isArray(value))
    return (
      <div className="ev-field">
        <span className="ev-label">{label}</span>
        {value.length ? (
          <div className="ev-nested">
            {value.map((item, index) => (
              <RecordedValue
                key={index}
                value={item}
                label={`${label} ${index + 1}`}
              />
            ))}
          </div>
        ) : (
          <p className="ev-note">No recorded items.</p>
        )}
      </div>
    );
  if (typeof value === "object")
    return (
      <div className="ev-field">
        <span className="ev-label">{label}</span>
        <div className="ev-nested">
          {Object.entries(record(value)).map(([key, item]) => (
            <RecordedValue
              key={key}
              label={key.replaceAll("_", " ")}
              value={item}
            />
          ))}
        </div>
      </div>
    );
  return (
    <div className="ev-field">
      <span className="ev-label">{label}</span>
      <p className="ev-text">{String(value)}</p>
    </div>
  );
}

function ContextAccounted({
  data,
}: {
  data: Record<string, unknown>;
}): ReactNode {
  const measured = num(data.measured);
  const limit = num(data.limit);
  if (measured == null || limit == null || limit <= 0) return null;
  const pct = (measured / limit) * 100;
  const pctLabel = pct >= 10 ? `${Math.round(pct)}%` : `${pct.toFixed(1)}%`;
  const unit = str(data.unit) ?? "tokens";
  const capacity = record(data.capacity);
  const reserved = num(data.reservedTokens);
  const maxOutput = num(data.maxOutputTokens);
  const scope = str(data.scope);
  const capTokens = num(capacity.tokens);
  const modelId = str(capacity.modelId);
  const verified = str(capacity.verifiedAt);
  const sourceUrl = str(capacity.sourceUrl);
  const method = str(data.method);
  const exceeds = data.exceeds === true || capacity.exceeds === true;
  return (
    <div className="ev-stack">
      <div>
        <div className="ev-budget-head">
          <span>
            <strong>{fmt(measured)}</strong>{" "}
            <span className="ev-muted">{unit} in context</span>
          </span>
          <span className="ev-muted">
            limit <span className="ev-strong">{fmt(limit)}</span>
          </span>
        </div>
        <div className="ev-bar" role="img" aria-label={`${pctLabel} of the limit`}>
          <div
            className="ev-bar-fill"
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
        <div className="ev-budget-foot">
          {pctLabel} of the limit
          {data.estimated ? " · estimated" : ""}
          {data.estimated && method ? ` with ${method.replaceAll("-", " ")}` : ""}
        </div>
      </div>
      <dl className="ev-well ev-dl">
        {reserved != null && (
          <>
            <dt>Reserved</dt>
            <dd>
              {fmt(reserved)} {unit}
            </dd>
          </>
        )}
        {maxOutput != null && (
          <>
            <dt>Max output</dt>
            <dd>
              {fmt(maxOutput)} {unit}
            </dd>
          </>
        )}
        {scope && (
          <>
            <dt>Counted</dt>
            <dd>{sentence(scope.replaceAll("-", " "))}</dd>
          </>
        )}
        {(modelId || capTokens != null) && (
          <>
            <dt>Model</dt>
            <dd>
              {modelId}
              {modelId && capTokens != null ? " · " : ""}
              {capTokens != null && `${fmt(capTokens)}-token capacity`}
            </dd>
          </>
        )}
        {(verified || sourceUrl) && (
          <>
            <dt>Verified</dt>
            <dd>
              {verified?.slice(0, 10)}
              {verified && sourceUrl ? " · " : ""}
              {sourceUrl && /^https?:\/\//i.test(sourceUrl) && (
                <a href={sourceUrl} target="_blank" rel="noreferrer">
                  capacity source
                </a>
              )}
            </dd>
          </>
        )}
        {exceeds && (
          <>
            <dt>Exceeds limit</dt>
            <dd className="ev-danger">Yes, over the recorded limit</dd>
          </>
        )}
      </dl>
    </div>
  );
}

function MessageWell({
  role,
  content,
  toolCalls,
}: {
  role: string;
  content: unknown;
  toolCalls: unknown;
}) {
  const [expanded, setExpanded] = useState(false);
  const text =
    typeof content === "string" ? content : content == null ? "" : json(content);
  const long = text.length > 500 || text.split("\n").length > 6;
  return (
    <div className="ev-well ev-message">
      <div className="ev-message-head">
        <span className="ev-role">{sentence(role)}</span>
        {long && <span className="ev-num">{fmt(words(text))} words</span>}
      </div>
      {text && (
        <p className={long && !expanded ? "ev-text ev-clamp" : "ev-text"}>
          {text}
        </p>
      )}
      {long && (
        <button
          type="button"
          className="ev-link-button"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? "Show less" : "Show the full prompt"}
        </button>
      )}
      {toolCalls != null && (
        <RecordedValue label="Recorded tool calls" value={toolCalls} />
      )}
    </div>
  );
}

const callSource = (call: unknown) => {
  const c = record(call);
  return { name: str(c.name), args: c.arguments ?? c.args };
};

function ToolCallBlock({ call, label }: { call: unknown; label: string }) {
  const { name, args } = callSource(call);
  let rendered = args;
  if (typeof args === "string") {
    try {
      rendered = JSON.parse(args);
    } catch {
      /* Preserve ordinary text verbatim. */
    }
  }
  return (
    <div>
      <div className="ev-label">{label}</div>
      <pre className="ev-pre">
        {name ?? "tool"}({rendered === undefined ? "" : json(rendered)})
      </pre>
    </div>
  );
}

function ToolEvent({
  type,
  data,
}: {
  type: string;
  data: Record<string, unknown>;
}) {
  const { name, args } = callSource(data.call);
  const toolName = name ?? str(data.name) ?? "tool";
  const disposition = str(data.disposition);
  let pill = "Result";
  let tone = "neutral";
  if (type === "tool_requested") pill = "Proposal";
  else if (type === "tool_admitted") {
    pill = "Admitted";
    tone = "success";
  } else if (
    type === "tool_denied" ||
    type === "tool_failed" ||
    disposition === "denied" ||
    disposition === "invalid"
  ) {
    pill = type === "tool_failed" ? "Failed" : "Denied";
    tone = "danger";
  } else if (type === "tool_result") {
    if (disposition && disposition !== "executed") pill = sentence(disposition);
  } else pill = sentence(type.replace(/^tool_/, ""));
  const argValue = args ?? data.arguments ?? data.args;
  const prose = ["result", "reason", "error"]
    .map((key) => data[key])
    .find((value) => value != null);
  return (
    <div className="ev-stack ev-stack-tight">
      <div className="ev-tool-head">
        <code className="ev-mono">{toolName}</code>
        <span className={`ev-pill ev-pill-${tone}`}>{pill}</span>
      </div>
      {argValue != null && (
        <pre className="ev-pre">
          {typeof argValue === "string" ? argValue : json(argValue)}
        </pre>
      )}
      {prose != null &&
        (typeof prose === "string" ? (
          <p className="ev-well ev-text">{prose}</p>
        ) : (
          <pre className="ev-pre">{json(prose)}</pre>
        ))}
    </div>
  );
}

const metadata = new Set([
  "runId",
  "threadId",
  "resourceId",
  "invocationId",
  "operationId",
  "toolCallId",
  "tools",
  "toolDefinitions",
  "schema",
  "schemaVersion",
  "model",
  "settings",
  "usage",
  "providerMetadata",
]);

export function RecordedEventContent({
  type,
  data,
  actor = "system",
}: {
  type: string;
  data: unknown;
  actor?: string;
}) {
  const source = record(data);
  if (type === "context_accounted") {
    const view = ContextAccounted({ data: source });
    if (view) return <>{view}</>;
  }
  if (type === "model_requested")
    return (
      <div className="ev-stack">
        <p className="ev-note">
          Model input as recorded. Repeated context, not a new action by {actor}.
        </p>
        {Array.isArray(source.messages) ? (
          source.messages.map((item, index) => {
            const message = record(item);
            return (
              <MessageWell
                key={index}
                role={String(message.role || "message")}
                content={message.content}
                toolCalls={message.toolCalls}
              />
            );
          })
        ) : (
          <p className="ev-note">No messages were recorded in this event.</p>
        )}
      </div>
    );
  if (type === "model_response") {
    const text = str(source.text) ?? str(source.content);
    const calls = Array.isArray(source.toolCalls) ? source.toolCalls : [];
    return (
      <div className="ev-stack">
        {text && <blockquote className="ev-quote">{text}</blockquote>}
        {calls.map((call, index) => (
          <ToolCallBlock key={index} call={call} label="Proposed tool call" />
        ))}
        {source.reasoning != null && (
          <details className="ev-details">
            <summary>Reasoning</summary>
            <p className="ev-text">
              {typeof source.reasoning === "string"
                ? source.reasoning
                : json(source.reasoning)}
            </p>
          </details>
        )}
      </div>
    );
  }
  if (type.startsWith("tool_")) return <ToolEvent type={type} data={source} />;
  const entries = Object.entries(source).filter(([key]) => !metadata.has(key));
  return (
    <div className="ev-stack ev-stack-tight">
      {entries.length ? (
        entries.map(([key, value]) => (
          <RecordedValue
            key={key}
            label={key.replaceAll("_", " ")}
            value={value}
          />
        ))
      ) : typeof data === "string" ? (
        <RecordedValue label="Recorded content" value={data} />
      ) : (
        <p className="ev-note">
          No readable message or result was recorded. Inspect the raw payload
          for metadata.
        </p>
      )}
    </div>
  );
}

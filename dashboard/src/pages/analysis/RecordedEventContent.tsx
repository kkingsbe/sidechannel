import type { ReactNode } from "react";

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

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
      <div>
        <strong>{label}</strong>
        {value.length ? (
          value.map((item, index) => (
            <RecordedValue
              key={index}
              value={item}
              label={`${label} ${index + 1}`}
            />
          ))
        ) : (
          <p className="helper">No recorded items.</p>
        )}
      </div>
    );
  if (typeof value === "object")
    return (
      <div>
        <strong>{label}</strong>
        {Object.entries(record(value)).map(([key, item]) => (
          <RecordedValue
            key={key}
            label={key.replaceAll("_", " ")}
            value={item}
          />
        ))}
      </div>
    );
  return (
    <p className="text-block">
      <strong>{label}: </strong>
      {String(value)}
    </p>
  );
}
export function RecordedEventContent({
  type,
  data,
}: {
  type: string;
  data: unknown;
}) {
  const source = record(data);
  if (type === "model_requested")
    return (
      <>
        <p className="helper">
          Recorded model input; repeated context is not a new action.
        </p>
        {Array.isArray(source.messages) ? (
          source.messages.map((item, index) => {
            const message = record(item);
            return (
              <div key={index}>
                <RecordedValue
                  label={`${String(message.role || "message")} ${index + 1}`}
                  value={message.content}
                />
                {message.toolCalls != null && (
                  <RecordedValue
                    label="Recorded tool calls"
                    value={message.toolCalls}
                  />
                )}
              </div>
            );
          })
        ) : (
          <p className="helper">No messages were recorded in this event.</p>
        )}
      </>
    );
  if (type === "model_response")
    return (
      <>
        {["text", "content", "toolCalls", "reasoning"]
          .filter((key) => source[key] != null)
          .map((key) => (
            <RecordedValue
              key={key}
              label={key === "toolCalls" ? "Proposed tool calls" : key}
              value={source[key]}
            />
          ))}
      </>
    );
  if (type.startsWith("tool_"))
    return (
      <>
        {[
          "call",
          "name",
          "arguments",
          "args",
          "result",
          "disposition",
          "error",
          "reason",
        ]
          .filter((key) => source[key] != null)
          .map((key) => (
            <RecordedValue key={key} label={key} value={source[key]} />
          ))}
      </>
    );
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
  const entries = Object.entries(source).filter(([key]) => !metadata.has(key));
  return (
    <>
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
        <p className="helper">
          No readable message or result was recorded. Inspect the raw recorded
          payload for metadata.
        </p>
      )}
    </>
  );
}

export function evidenceKey(item: unknown, index: number) {
  const object = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
  return String(
    object.id ??
      (object.version !== undefined
        ? "version-" + object.version
        : object.agentId !== undefined
          ? "agent-" + object.agentId
          : "record-" + index),
  );
}

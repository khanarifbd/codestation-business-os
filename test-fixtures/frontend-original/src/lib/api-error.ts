export function getApiErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;

  const source = payload as { detail?: unknown; message?: unknown };
  const { detail } = source;

  if (typeof detail === "string" && detail.trim()) return detail;

  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const entry = item as { msg?: unknown; message?: unknown; loc?: unknown };
          const message = typeof entry.msg === "string"
            ? entry.msg
            : typeof entry.message === "string"
              ? entry.message
              : null;
          if (!message) return null;
          if (Array.isArray(entry.loc)) {
            const field = entry.loc.filter((part) => part !== "body").join(" → ");
            return field ? `${field}: ${message}` : message;
          }
          return message;
        }
        return null;
      })
      .filter((value): value is string => Boolean(value));

    if (messages.length) return messages.join(" · ");
  }

  if (detail && typeof detail === "object") {
    const nested = detail as { message?: unknown; msg?: unknown };
    if (typeof nested.message === "string" && nested.message.trim()) return nested.message;
    if (typeof nested.msg === "string" && nested.msg.trim()) return nested.msg;
  }

  if (typeof source.message === "string" && source.message.trim()) return source.message;
  return fallback;
}

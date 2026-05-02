function genSessionId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return `sess_${crypto.randomUUID()}`;
    }
  } catch {
    /* fall through */
  }
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

let cachedSessionId: string | null = null;

export function sessionId(): string {
  if (!cachedSessionId) cachedSessionId = genSessionId();
  return cachedSessionId;
}

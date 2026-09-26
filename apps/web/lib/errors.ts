/** Raw error info extracted from a failed API response body. */
export interface ApiErrorPayload {
  /** The `error`/`message` field from the JSON body, or the raw text body. */
  code: string;
  status: number;
  retryAfter?: number;
}

/**
 * Read a failed response's body (JSON or plain text) and pull out the error code and
 * optional retry-after hint. This is the parsing boilerplate that used to be copy-pasted
 * into every page's own `readError`/`parseErrorResponse` helper; each page still maps
 * the resulting `code` to its own user-facing copy, since the right message for a given
 * code differs by flow (login vs signup vs password reset).
 */
export async function readApiError(res: Response): Promise<ApiErrorPayload> {
  const status = res.status;
  try {
    const contentType = res.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      const data = await res.json();
      return {
        code: String(data.error || data.message || ""),
        status,
        retryAfter: Number(data.retry_after) || undefined,
      };
    }
    const text = (await res.text()).trim();
    if (text) {
      try {
        const data = JSON.parse(text);
        return {
          code: String(data.error || data.message || text),
          status,
          retryAfter: Number(data.retry_after) || undefined,
        };
      } catch {
        return { code: text, status };
      }
    }
  } catch {
    // ignore — fall through to the empty-code default below
  }
  return { code: "", status };
}

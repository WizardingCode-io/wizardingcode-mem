// The JSON answers every HTTP server of the product gives: the viewer's and the team server's.
// A leaf: no store, no settings, nothing but the Response.

/** A JSON answer with the status, the headers every answer carries, and any extra header given. */
export function json(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

/** A problem answer: `{ error: detail, ...extra }` with the status. */
export function problem(status: number, detail: string, extra?: Record<string, unknown>): Response {
  return json({ error: detail, ...extra }, status);
}

/** A JSON object from the request, or the 400 to answer with. */
export async function jsonObject(request: Request): Promise<Record<string, unknown> | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return problem(400, "body must be JSON");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return problem(400, "body must be an object");
  }
  return body as Record<string, unknown>;
}

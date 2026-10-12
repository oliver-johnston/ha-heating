export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function apiUrl(path: string) {
  return `./api/${path}`;
}

export async function apiRequest<T>(
  path: string,
  options?: RequestInit,
  fallbackMessage = "The request failed",
): Promise<T> {
  const response = await fetch(apiUrl(path), options);
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new ApiError(body.error || fallbackMessage, response.status, body);
  }
  return body;
}

export function jsonRequest(method: "POST" | "PUT", body?: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

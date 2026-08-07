const internalApiUrl =
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://127.0.0.1:8000/api/v1";

export function backendUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${internalApiUrl.replace(/\/$/, "")}${normalizedPath}`;
}

export async function backendFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(backendUrl(path), {
    ...init,
    cache: "no-store",
  });
}

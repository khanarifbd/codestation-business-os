import { clearAuthCookies } from "@/lib/auth-session";
import { proxyPublicAuthAction } from "@/lib/public-auth-proxy";

export async function POST(request: Request) {
  const response = await proxyPublicAuthAction(request, "/auth/reset-password");
  if (response.ok) {
    // A successful password reset increments auth_token_version on the backend,
    // so every existing access/refresh token is revoked. Clear the browser-side
    // session and workspace cookie immediately to avoid carrying stale tenant
    // context into the next login.
    clearAuthCookies(response);
    response.headers.set("X-Auth-Session-Revoked", "1");
  }
  return response;
}

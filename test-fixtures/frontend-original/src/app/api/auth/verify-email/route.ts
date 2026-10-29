import { proxyPublicAuthAction } from "@/lib/public-auth-proxy";

export async function POST(request: Request) {
  return proxyPublicAuthAction(request, "/auth/verify-email");
}

/** Transport failures, timeouts, malformed responses and server errors cannot prove a POST rolled back. */
export class InventoryRequestError extends Error {
  constructor(message: string, readonly status: number, readonly structured: boolean) { super(message); }
}
export function isUncertainInventoryWrite(reason: unknown) {
  return !(reason instanceof InventoryRequestError && reason.structured && [400, 401, 403, 404, 409, 422, 429].includes(reason.status));
}
export const isStockPosting = (url: string, method: string) => method === "POST" && ["/api/inventory/adjustments", "/api/inventory/purchases", "/api/inventory/transfers"].includes(url);

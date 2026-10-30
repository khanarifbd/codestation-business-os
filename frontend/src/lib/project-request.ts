import { getApiErrorMessage } from "@/lib/api-error";

/** A definite rejected request is different from an interrupted, possibly committed write. */
export class ProjectRequestRejected extends Error {}
export const projectRequestWasRejected = (status: number, payload: unknown) =>
  [400, 401, 403, 404, 405, 409, 410, 413, 415, 422, 429].includes(status) && Boolean(getApiErrorMessage(payload, ""));
export const PROJECT_WRITE_UNKNOWN = "The save result could not be confirmed. Do not submit it again. Return to the project and check the latest records before starting another change.";

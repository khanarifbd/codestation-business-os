import { getApiErrorMessage } from "@/lib/api-error";

/** A definite rejected request is different from an interrupted, possibly committed write. */
export class ProjectRequestRejected extends Error {}
export const projectRequestWasRejected = (status: number, payload: unknown) => {
  if (![400, 401, 403, 404, 405, 409, 410, 413, 415, 422].includes(status)) return false;
  const detail = getApiErrorMessage(payload, "").trim();
  // A transport/proxy placeholder is not evidence that an unkeyed write failed.
  return Boolean(detail) && !/^(?:unexpected upstream response|project request failed)\.?$/i.test(detail);
};
export const PROJECT_WRITE_UNKNOWN = "The save result could not be confirmed. Do not submit it again. Return to the project and check the latest records before starting another change.";

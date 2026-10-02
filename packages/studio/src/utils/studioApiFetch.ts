import { STUDIO_API_SAME_ORIGIN_CREDENTIALS } from "../components/editor/manualEditingAvailability";

export function studioApiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return globalThis.fetch(input, {
    ...init,
    credentials: STUDIO_API_SAME_ORIGIN_CREDENTIALS ? "same-origin" : "omit",
  });
}

import { STUDIO_API_SAME_ORIGIN_CREDENTIALS } from "../components/editor/manualEditingAvailability";

/**
 * Studio's one way to fetch. Without credentials Chrome pools these sockets apart from the preview's media,
 * whose paused videos can hold all six a host gets and leave an undo waiting behind them.
 */
export function studioApiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  // eslint-disable-next-line no-restricted-globals -- the owner every other call routes through
  return fetch(input, {
    ...init,
    credentials: STUDIO_API_SAME_ORIGIN_CREDENTIALS ? "same-origin" : "omit",
  });
}

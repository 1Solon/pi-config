/**
 * Domain model for background terminals.
 *
 * A "terminal" is one long-running shell process started by the model. It
 * receives no stdin (launched with stdin: "ignore"), captures stdout and
 * stderr separately, and settles exactly once into a final state.
 */

import { Data } from "effect";

export {
  formatElapsed,
  formatExit,
  MAX_RUNNING,
} from "./public-domain.ts";
export type {
  OutputView,
  TerminalSnapshot,
  TerminalStatus,
} from "./public-domain.ts";

// --- Errors -------------------------------------------------------------------

export class SpawnError extends Data.TaggedError("SpawnError")<{
  readonly message: string;
}> {}

export class ConcurrencyLimitError extends Data.TaggedError(
  "ConcurrencyLimitError",
)<{
  readonly message: string;
}> {}

export class UnknownTerminalError extends Data.TaggedError(
  "UnknownTerminalError",
)<{
  readonly message: string;
}> {}

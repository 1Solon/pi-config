import { NodeServices } from "@effect/platform-node";
import { Cause, Data, Effect, Exit } from "effect";
import {
  currentTarget,
  liveBinaryEnv,
  repositoryBinDir,
  resolveBinary,
  TOOL_SPECS,
  type BinarySource,
  type PlatformTarget,
  type ResolvedBinary,
} from "./binaries.ts";
import { formatCapturedOutput, type CapturedOutput } from "./output.ts";
import { discardCapturedOutput, executeSearchProcess } from "./process.ts";

export function makeBinaryInitializers(
  binDir: string,
  target: PlatformTarget,
  env: typeof liveBinaryEnv,
) {
  return {
    fd: Effect.runSync(
      Effect.cached(resolveBinary(TOOL_SPECS.fd, binDir, target, env)),
    ),
    rg: Effect.runSync(
      Effect.cached(resolveBinary(TOOL_SPECS.rg, binDir, target, env)),
    ),
  };
}

/** Human-readable install notice, shown only for fresh downloads. */
export function installNotifications(binaries: readonly ResolvedBinary[]) {
  return binaries
    .filter((binary) => binary.source === "installed")
    .map(
      (binary) =>
        `file-search: no system ${binary.tool} found — downloaded ${binary.tool} ${binary.version ?? ""}`.trimEnd() +
        ` to ${repositoryBinDir()}`,
    );
}

class SearchError extends Data.TaggedError("SearchError")<{
  readonly message: string;
}> {}

interface SearchOutcome {
  readonly output: CapturedOutput;
  readonly noMatches: boolean;
  readonly binary: ResolvedBinary;
}

export interface LazySearchResult {
  readonly text: string;
  readonly noMatches: boolean;
  readonly binarySource: BinarySource;
  readonly outputLines: number;
  readonly truncated: boolean;
  readonly fullOutputPath?: string;
  readonly notifications: readonly string[];
}

const EXEC_TIMEOUT_MS = 60_000;
const binDir = repositoryBinDir();
const target = currentTarget();
const initializers = makeBinaryInitializers(binDir, target, liveBinaryEnv);

function causeMessage<E>(cause: Cause.Cause<E>) {
  const [first] = Cause.prettyErrors(cause);
  return first?.message ?? Cause.pretty(cause);
}

function unwrapExit<A, E>(exit: Exit.Exit<A, E>, tool: "fd" | "rg") {
  if (Exit.isSuccess(exit)) return exit.value;
  if (Cause.hasInterruptsOnly(exit.cause)) {
    throw new Error(`${tool} search was cancelled.`);
  }
  throw new Error(causeMessage(exit.cause));
}

function runSearch(tool: "fd" | "rg", args: string[], cwd: string) {
  return Effect.gen(function* () {
    const binary = yield* initializers[tool];
    const result = yield* executeSearchProcess({
      command: binary.command,
      args,
      cwd,
      tempPrefix: `pi-${tool}-`,
    });

    if (tool === "rg" && result.code === 1 && result.output.lineCount === 0) {
      return { output: result.output, noMatches: true, binary } satisfies SearchOutcome;
    }
    if (result.code !== 0) {
      yield* discardCapturedOutput(result.output);
      const detail = result.stderr.trim() || `exit code ${result.code}`;
      return yield* new SearchError({ message: `${tool} failed: ${detail}` });
    }
    return {
      output: result.output,
      noMatches: result.output.lineCount === 0,
      binary,
    } satisfies SearchOutcome;
  }).pipe(
    Effect.timeout(EXEC_TIMEOUT_MS),
    Effect.mapError((error) => {
      if (error instanceof SearchError) return error;
      return new SearchError({
        message:
          error._tag === "TimeoutError"
            ? `${tool} timed out.`
            : error instanceof Error
              ? error.message
              : String(error),
      });
    }),
    Effect.provide(NodeServices.layer),
  );
}

/** Load the heavy Effect runtime and resolve binaries only on first tool use. */
export async function executeLazySearch(options: {
  tool: "fd" | "rg";
  args: string[];
  cwd: string;
  signal?: AbortSignal;
}): Promise<LazySearchResult> {
  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const outcome = yield* runSearch(options.tool, options.args, options.cwd);
      if (outcome.noMatches) {
        return {
          text: options.tool === "fd" ? "No files found" : "No matches found",
          noMatches: true,
          binarySource: outcome.binary.source,
          outputLines: 0,
          truncated: false,
          notifications: installNotifications([outcome.binary]),
        } satisfies LazySearchResult;
      }

      const formatted = formatCapturedOutput(outcome.output);
      return {
        text: formatted.text,
        noMatches: false,
        binarySource: outcome.binary.source,
        outputLines: formatted.lineCount,
        truncated: formatted.truncated,
        fullOutputPath: formatted.fullOutputPath,
        notifications: installNotifications([outcome.binary]),
      } satisfies LazySearchResult;
    }),
    options.signal ? { signal: options.signal } : undefined,
  );
  return unwrapExit(exit, options.tool);
}

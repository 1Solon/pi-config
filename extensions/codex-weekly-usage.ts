import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const PROVIDER_ID = "openai-codex";
const STATUS_ID = "codex-weekly-usage";
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const REQUEST_TIMEOUT_MS = 10_000;
const WEEK_MIN_SECONDS = 24 * 60 * 60;

type UsageWindow = {
	used_percent?: unknown;
	limit_window_seconds?: unknown;
};

type UsageResponse = {
	rate_limit?: {
		primary_window?: UsageWindow | null;
		secondary_window?: UsageWindow | null;
	} | null;
};

export function extractAccountId(token: string): string | undefined {
	const payload = token.split(".")[1];
	if (!payload) return undefined;

	try {
		const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
		const auth = decoded["https://api.openai.com/auth"];
		if (!auth || typeof auth !== "object") return undefined;
		const accountId = (auth as Record<string, unknown>).chatgpt_account_id;
		return typeof accountId === "string" && accountId.length > 0 ? accountId : undefined;
	} catch {
		return undefined;
	}
}

export function weeklyRemainingPercent(payload: UsageResponse): number | undefined {
	const rateLimit = payload.rate_limit;
	if (!rateLimit) return undefined;

	const windows = [rateLimit.primary_window, rateLimit.secondary_window]
		.filter((window): window is UsageWindow => window !== null && window !== undefined)
		.map((window) => ({
			used: Number(window.used_percent),
			duration: Number(window.limit_window_seconds),
		}))
		.filter(
			(window) =>
				Number.isFinite(window.used) &&
				Number.isFinite(window.duration) &&
				window.duration >= WEEK_MIN_SECONDS,
		)
		.sort((a, b) => b.duration - a.duration);

	const weekly = windows[0];
	if (!weekly) return undefined;
	return Math.round(Math.max(0, Math.min(100, 100 - weekly.used)));
}

export default function (pi: ExtensionAPI) {
	let latestRequest = 0;
	let hasValue = false;

	const clear = (ctx: ExtensionContext) => {
		latestRequest += 1;
		hasValue = false;
		ctx.ui.setStatus(STATUS_ID, undefined);
	};

	const refresh = async (ctx: ExtensionContext) => {
		if (ctx.model?.provider !== PROVIDER_ID) {
			clear(ctx);
			return;
		}

		const request = ++latestRequest;
		if (!hasValue) {
			ctx.ui.setStatus(STATUS_ID, ctx.ui.theme.fg("dim", "Codex-Weekly: loading…"));
		}

		try {
			const token = await ctx.modelRegistry.getApiKeyForProvider(PROVIDER_ID);
			if (!token) throw new Error("Codex OAuth is not configured");

			const headers: Record<string, string> = {
				Accept: "application/json",
				Authorization: `Bearer ${token}`,
			};
			const accountId = extractAccountId(token);
			if (accountId) headers["ChatGPT-Account-Id"] = accountId;

			const response = await fetch(USAGE_URL, {
				headers,
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
			if (!response.ok) throw new Error(`Usage request failed (${response.status})`);

			const remaining = weeklyRemainingPercent((await response.json()) as UsageResponse);
			if (remaining === undefined) throw new Error("Weekly usage window is unavailable");
			if (request !== latestRequest) return;

			hasValue = true;
			ctx.ui.setStatus(
				STATUS_ID,
				ctx.ui.theme.fg("dim", `Codex-Weekly: ${remaining}% left`),
			);
		} catch {
			if (request !== latestRequest) return;
			hasValue = false;
			ctx.ui.setStatus(STATUS_ID, ctx.ui.theme.fg("dim", "Codex-Weekly: unavailable"));
		}
	};

	pi.on("session_start", (_event, ctx) => {
		void refresh(ctx);
	});

	pi.on("input", (_event, ctx) => {
		void refresh(ctx);
	});

	pi.on("agent_settled", (_event, ctx) => {
		void refresh(ctx);
	});

	pi.on("model_select", (_event, ctx) => {
		void refresh(ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		clear(ctx);
	});
}

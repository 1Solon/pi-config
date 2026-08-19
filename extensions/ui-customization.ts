import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
	ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

interface RenderableNode {
	children?: RenderableNode[];
	invalidate(): void;
	render(width: number): string[];
}

interface DashboardTui extends RenderableNode {
	requestRender(force?: boolean): void;
}

const ANSI_PATTERN =
	/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;
const CHARS_PER_ESTIMATED_TOKEN = 4;
const LIVE_UPDATE_INTERVAL_MS = 200;

function hasChildren(
	component: RenderableNode,
): component is RenderableNode & { children: RenderableNode[] } {
	return Array.isArray(component.children);
}

function renderedText(component: RenderableNode) {
	try {
		return component.render(200).join("\n").replace(ANSI_PATTERN, "");
	} catch {
		return "";
	}
}

export function hideThemesSection(component: RenderableNode): boolean {
	if (!hasChildren(component)) return false;

	for (let index = 0; index < component.children.length; index += 1) {
		const child = component.children[index]!;
		const firstLine = renderedText(child)
			.split("\n")
			.find((line) => line.trim())
			?.trim();

		if (firstLine === "[Themes]") {
			const removeCount =
				component.children[index + 1] &&
				renderedText(component.children[index + 1]!).trim() === ""
					? 2
					: 1;
			component.children.splice(index, removeCount);
			component.invalidate();
			return true;
		}

		if (hideThemesSection(child)) return true;
	}

	return false;
}

export function formatTokens(tokens: number) {
	if (tokens < 1_000) return `${tokens}`;
	if (tokens < 1_000_000) return `${Math.round(tokens / 1_000)}k`;
	return `${(tokens / 1_000_000).toFixed(1)}m`;
}

export function formatDirectory(cwd: string) {
	const home = resolve(homedir());
	const directory = resolve(cwd);
	const fromHome = relative(home, directory);
	if (fromHome === "") return "~";
	if (!fromHome.startsWith("..") && !isAbsolute(fromHome)) {
		return `~/${fromHome.replaceAll("\\", "/")}`;
	}
	return cwd;
}

export function columns(left: string, right: string, width: number) {
	if (!right) return truncateToWidth(left, width);

	const naturalGap = width - visibleWidth(left) - visibleWidth(right);
	if (naturalGap >= 1) return `${left}${" ".repeat(naturalGap)}${right}`;

	const leftWidth = Math.max(1, Math.floor(width * 0.45));
	const rightWidth = Math.max(1, width - leftWidth - 1);
	const fittedLeft = truncateToWidth(left, leftWidth);
	const fittedRight = truncateToWidth(right, rightWidth);
	const gap = Math.max(
		1,
		width - visibleWidth(fittedLeft) - visibleWidth(fittedRight),
	);
	return truncateToWidth(
		`${fittedLeft}${" ".repeat(gap)}${fittedRight}`,
		width,
	);
}

function getSessionCost(ctx: ExtensionContext) {
	let cost = 0;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type === "message" && entry.message.role === "assistant") {
			cost += entry.message.usage.cost.total;
		}
	}
	return cost;
}

function estimateContentTokens(characters: number) {
	return Math.ceil(characters / CHARS_PER_ESTIMATED_TOKEN);
}

export default function uiCustomization(pi: ExtensionAPI) {
	let activeTui: DashboardTui | undefined;
	let requestRender: (() => void) | undefined;
	let themeRemovalTimers: Array<ReturnType<typeof setTimeout>> = [];
	let tokensPerSecond: number | null = null;
	let contentStreamStart: number | null = null;
	let lastContentDeltaAt: number | null = null;
	let contentCharacters = 0;
	let firstContentDeltaCharacters = 0;
	let contentDeltaCount = 0;
	let sawToolCall = false;
	let runContentTokens = 0;
	let runContentStreamMs = 0;
	let lastLiveUpdate = 0;

	function resetMessageTracking() {
		contentStreamStart = null;
		lastContentDeltaAt = null;
		contentCharacters = 0;
		firstContentDeltaCharacters = 0;
		contentDeltaCount = 0;
		sawToolCall = false;
		lastLiveUpdate = 0;
	}

	function scheduleThemeRemoval(tui: DashboardTui) {
		for (const timer of themeRemovalTimers) clearTimeout(timer);
		themeRemovalTimers = [];

		for (const delay of [0, 50, 250, 1_000]) {
			themeRemovalTimers.push(
				setTimeout(() => {
					if (hideThemesSection(tui)) tui.requestRender(true);
				}, delay),
			);
		}
	}

	function install(ctx: ExtensionContext) {
		if (ctx.mode !== "tui") return;

		ctx.ui.setFooter((tui, theme, footerData: ReadonlyFooterDataProvider) => {
			activeTui = tui;
			requestRender = () => tui.requestRender();
			scheduleThemeRemoval(tui);

			return {
				invalidate() {},
				render(width: number) {
					const usage = ctx.getContextUsage();
					const contextPercent = usage ? `${Math.round(usage.percent)}` : "?";
					const contextWindowTokens =
						usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
					const contextWindow =
						contextWindowTokens > 0 ? formatTokens(contextWindowTokens) : "?";
					const model = ctx.model
						? `${ctx.model.provider}/${ctx.model.id} · ${ctx.model.reasoning ? pi.getThinkingLevel() : "off"}`
						: "no-model";
					const speed =
						tokensPerSecond === null
							? "— tok/s"
							: `${Math.round(tokensPerSecond)} tok/s`;
					const stats = `${contextPercent}%/${contextWindow} · $${getSessionCost(ctx).toFixed(2)} · ${speed}`;
					const lines = [
						columns(theme.fg("text", formatDirectory(ctx.cwd)), theme.fg("muted", model), width),
						truncateToWidth(theme.fg("muted", stats), width),
					];

					const statuses = footerData.getExtensionStatuses();
					for (const [, text] of [...statuses.entries()].sort(([a], [b]) => a.localeCompare(b))) {
						for (const statusLine of text.split("\n")) {
							lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "...")));
						}
					}

					return lines;
				},
			};
		});

		ctx.ui.setTitle(`pi · ${formatDirectory(ctx.cwd)}`);
	}

	pi.on("session_start", (_event, ctx) => {
		tokensPerSecond = null;
		runContentTokens = 0;
		runContentStreamMs = 0;
		resetMessageTracking();
		install(ctx);
	});

	pi.on("resources_discover", () => {
		if (activeTui) scheduleThemeRemoval(activeTui);
	});

	pi.on("model_select", () => requestRender?.());
	pi.on("thinking_level_select", () => requestRender?.());

	pi.on("agent_start", () => {
		tokensPerSecond = null;
		runContentTokens = 0;
		runContentStreamMs = 0;
		resetMessageTracking();
		requestRender?.();
	});

	pi.on("message_start", (event) => {
		if (event.message.role === "assistant") resetMessageTracking();
	});

	pi.on("message_update", (event) => {
		if (event.message.role !== "assistant") return;
		const streamEvent = event.assistantMessageEvent;
		if (streamEvent.type === "toolcall_delta") {
			sawToolCall = true;
			return;
		}
		if (
			streamEvent.type !== "text_delta" &&
			streamEvent.type !== "thinking_delta"
		) return;
		if (!streamEvent.delta) return;

		const now = Date.now();
		if (contentStreamStart === null) {
			contentStreamStart = now;
			firstContentDeltaCharacters = streamEvent.delta.length;
		}
		lastContentDeltaAt = now;
		contentCharacters += streamEvent.delta.length;
		contentDeltaCount += 1;

		const elapsedMs = now - contentStreamStart;
		const streamedCharacters = contentCharacters - firstContentDeltaCharacters;
		if (
			contentDeltaCount < 2 ||
			elapsedMs <= 0 ||
			streamedCharacters <= 0 ||
			now - lastLiveUpdate < LIVE_UPDATE_INTERVAL_MS
		) return;

		lastLiveUpdate = now;
		tokensPerSecond =
			estimateContentTokens(streamedCharacters) / (elapsedMs / 1_000);
		requestRender?.();
	});

	pi.on("message_end", (event) => {
		if (event.message.role !== "assistant") return;
		sawToolCall ||= event.message.content.some((block) => block.type === "toolCall");

		if (contentStreamStart !== null && contentCharacters > 0) {
			const streamEnd = lastContentDeltaAt ?? contentStreamStart;
			const streamMs = streamEnd - contentStreamStart;
			const firstDeltaTokens = estimateContentTokens(firstContentDeltaCharacters);
			const streamedTokens =
				!sawToolCall && event.message.usage.output > 0
					? Math.max(0, event.message.usage.output - firstDeltaTokens)
					: Math.max(0, estimateContentTokens(contentCharacters) - firstDeltaTokens);

			if (contentDeltaCount >= 2 && streamMs >= 50 && streamedTokens > 0) {
				runContentTokens += streamedTokens;
				runContentStreamMs += streamMs;
				tokensPerSecond = runContentTokens / (runContentStreamMs / 1_000);
			}
		}

		resetMessageTracking();
		requestRender?.();
	});

	pi.on("turn_end", () => requestRender?.());
	pi.on("agent_settled", () => requestRender?.());

	pi.on("session_shutdown", (_event, ctx) => {
		for (const timer of themeRemovalTimers) clearTimeout(timer);
		themeRemovalTimers = [];
		activeTui = undefined;
		requestRender = undefined;
		if (ctx.mode === "tui") ctx.ui.setFooter(undefined);
	});
}

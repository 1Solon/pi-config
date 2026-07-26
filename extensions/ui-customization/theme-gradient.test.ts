import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { stripVTControlCharacters } from "node:util";
import {
  HEADER_GRADIENT_TOKENS,
  gradientText,
  type ThemeForeground,
} from "./src/theme-gradient.ts";

test("gradientText applies the warm semantic token progression", () => {
  const calls: Array<{ color: string; text: string }> = [];
  const theme: ThemeForeground = {
    fg(color, text) {
      calls.push({ color, text });
      return `<${color}>${text}</${color}>`;
    },
  };

  gradientText(theme, "ABCDEFG", 0);

  assert.deepEqual(HEADER_GRADIENT_TOKENS, [
    "dim",
    "warning",
    "accent",
    "text",
    "accent",
    "warning",
  ]);
  assert.deepEqual(
    calls.map(({ color }) => color),
    ["dim", "warning", "accent", "text", "accent", "warning", "dim"],
  );
});

test("gradientText is periodic for integer phase offsets", () => {
  const colorsForPhase = (phase: number) => {
    const calls: string[] = [];
    const theme: ThemeForeground = {
      fg(color, text) {
        calls.push(color);
        return text;
      },
    };

    gradientText(theme, "ABCDEFG", phase);
    return calls;
  };

  const baseCalls = colorsForPhase(0);
  assert.deepEqual(colorsForPhase(1), baseCalls);
  assert.deepEqual(colorsForPhase(-1), baseCalls);
});

test("gradientText leaves spaces unstyled", () => {
  const calls: Array<{ color: string; text: string }> = [];
  const theme: ThemeForeground = {
    fg(color, text) {
      calls.push({ color, text });
      return `<${color}>${text}</${color}>`;
    },
  };

  const result = gradientText(theme, "A B", 0);

  assert.equal(result, "<dim>A</dim> <dim>B</dim>");
  assert.deepEqual(
    calls.map(({ text }) => text),
    ["A", "B"],
  );
});

test("gradientText preserves terminal-visible width", () => {
  const theme: ThemeForeground = {
    fg(_color, text) {
      return `\x1b[31m${text}\x1b[0m`;
    },
  };

  const text = "PI header";
  const result = gradientText(theme, text, 0.18);

  assert.equal(
    [...stripVTControlCharacters(result)].length,
    [...text].length,
  );
});

test("source-level integration guard for the auto-discovered extension entry point", () => {
  const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

  assert.ok(source.includes('import { gradientText } from "./src/theme-gradient.ts";'));
  assert.ok(source.includes("ctx.ui.setHeader((tui, theme) => {"));
  assert.ok(source.includes("gradientText(theme, line, row * 0.045)"));
  assert.ok(source.includes("theme.bold(gradientText(theme, title, 0.18))"));
  assert.ok(!source.includes("const PALETTE"));
  assert.ok(!source.includes("sampleGradient"));
  assert.ok(!source.includes("function foreground"));
});

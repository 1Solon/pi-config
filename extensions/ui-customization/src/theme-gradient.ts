import type {
  Theme,
  ThemeColor,
} from "@earendil-works/pi-coding-agent";

export type ThemeForeground = Pick<Theme, "fg">;

export const HEADER_GRADIENT_TOKENS = [
  "dim",
  "warning",
  "accent",
  "text",
  "accent",
  "warning",
] as const satisfies readonly ThemeColor[];

export function gradientText(
  theme: ThemeForeground,
  text: string,
  phase: number,
) {
  const characters = [...text];
  const span = Math.max(characters.length - 1, 1);
  const normalizedPhase = phase - Math.floor(phase);

  return characters
    .map((character, index) => {
      if (character === " ") return character;

      const unwrappedPosition = index / span + normalizedPhase;
      const position = unwrappedPosition >= 1
        ? unwrappedPosition - 1
        : unwrappedPosition;
      const tokenIndex = Math.floor(
        position * HEADER_GRADIENT_TOKENS.length,
      );
      const token = HEADER_GRADIENT_TOKENS[tokenIndex]!;
      return theme.fg(token, character);
    })
    .join("");
}

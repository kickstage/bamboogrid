import { useComputedColorScheme } from "@mantine/core";

// Wordmark aspect ratio is ~9.86:1 (source SVG is 720×73).
const ASPECT = 720 / 73;

export function Logo({
  height = 24,
  style,
}: {
  height?: number;
  style?: React.CSSProperties;
}) {
  const scheme = useComputedColorScheme("light");
  const src =
    scheme === "dark"
      ? "/bamboogrid-logo-on-dark.svg"
      : "/bamboogrid-logo-on-light.svg";
  return (
    <img
      src={src}
      alt="BambooGrid"
      height={height}
      width={Math.round(height * ASPECT)}
      style={{ display: "block", ...style }}
    />
  );
}

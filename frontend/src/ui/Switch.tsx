import { Switch as MantineSwitch, type SwitchProps } from "@mantine/core";

// Mantine Switch with a pointer cursor on the track/label and a non-selectable
// label, so toggling never leaves the label text highlighted. Caller styles are
// merged on top.
export function Switch({ styles, ...props }: SwitchProps) {
  return (
    <MantineSwitch
      styles={{
        track: { cursor: "pointer" },
        label: { cursor: "pointer", userSelect: "none" },
        ...styles,
      }}
      {...props}
    />
  );
}

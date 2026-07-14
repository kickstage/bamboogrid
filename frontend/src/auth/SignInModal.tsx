// Shown when a guest reaches for something that needs an account (today: "My
// scenarios"). Rather than hiding the feature until sign-in, we surface it and
// explain here what signing in buys — and that export/import stays available
// without an account, so nobody feels cornered into it.

import { Divider, Group, Modal, Stack, Text } from "@mantine/core";
import { GoogleButton } from "./GoogleSignIn";

export function SignInModal({
  opened,
  onClose,
}: {
  opened: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Sign in to save scenarios"
      size="md"
      centered
    >
      <Stack gap="md">
        <Text size="sm">
          Sign in with Google to keep a library of scenarios. Everything you
          build is then saved as you work, and you can reopen it any time from{" "}
          <b>My scenarios</b>.
        </Text>

        <Group justify="center" py={4}>
          <GoogleButton size="large" />
        </Group>

        <Divider label="or stay a guest" labelPosition="center" />

        <Text size="sm" c="dimmed">
          You don’t need an account to use BambooGrid. <b>File ▸ Export</b>{" "}
          downloads the scenario you’re working on as a pandapower JSON file,
          and <b>File ▸ Import</b> opens it again later.
        </Text>
      </Stack>
    </Modal>
  );
}

import { notifications } from "@mantine/notifications";

// Thin wrapper over Mantine notifications for transient status feedback
// (load-flow results, import/export, sharing, sync errors). Errors linger
// longer since they often carry a message the user needs to read.
export const toast = {
  success: (message: string) =>
    notifications.show({ message, color: "teal", autoClose: 3000 }),
  info: (message: string) =>
    notifications.show({ message, color: "blue", autoClose: 3000 }),
  error: (message: string) =>
    notifications.show({ message, color: "red", autoClose: 6000 }),
};

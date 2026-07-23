import { Center, Loader, Text } from "@mantine/core";

// The loader/error placeholder shown while a tool window's data is in flight:
// the error message if the fetch failed, otherwise a spinner.
export function Pending({
  error,
  size,
}: {
  error: string | null;
  size?: string;
}) {
  return (
    <Center py="xl">
      {error ? (
        <Text c="red" size="sm">
          {error}
        </Text>
      ) : (
        <Loader size={size} />
      )}
    </Center>
  );
}

import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Box,
  CopyButton,
  Group,
  Modal,
  NumberInput,
  SegmentedControl,
  Stack,
  Tabs,
  Text,
  Textarea,
  Tooltip,
} from "@mantine/core";
import "./EmbedModal.css";

function CopyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

interface Props {
  opened: boolean;
  onClose: () => void;
  sessionId: string | null;
  networkName: string;
}

type EmbedTheme = "light" | "dark" | "auto";

function buildEmbedUrl(
  sessionId: string,
  theme: EmbedTheme,
  controls: boolean,
): string {
  const base = `${window.location.origin}/embed/${sessionId}`;
  const params = new URLSearchParams();
  if (theme !== "auto") params.set("theme", theme);
  if (!controls) params.set("controls", "false");
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

function buildIframeCode(
  sessionId: string,
  networkName: string,
  theme: EmbedTheme,
  controls: boolean,
  height: number,
): string {
  const src = buildEmbedUrl(sessionId, theme, controls);
  const escapedName = networkName.replace(/"/g, "&quot;");
  return [
    `<iframe`,
    `  src="${src}"`,
    `  width="100%"`,
    `  height="${height}"`,
    `  style="border: 1px solid #e0e0e0; border-radius: 8px;"`,
    `  loading="lazy"`,
    `  sandbox="allow-scripts allow-same-origin"`,
    `  title="BambooGrid – ${escapedName}"`,
    `></iframe>`,
  ].join("\n");
}

function buildHtmlCode(
  sessionId: string,
  networkName: string,
  theme: EmbedTheme,
  controls: boolean,
  height: number,
): string {
  const src = buildEmbedUrl(sessionId, theme, controls);
  return [
    `<div class="bamboogrid-embed"`,
    `     data-src="${src}"`,
    `     data-height="${height}"`,
    `     style="height:${height}px; box-sizing:border-box; display:flex;`,
    `            align-items:center; justify-content:center; border:1px solid #e0e0e0;`,
    `            border-radius:8px; padding:1em;">`,
    `  <span>See <a href="${window.location.origin}">`,
    `    ${networkName.replace(/</g, "&lt;")}</a> on <a href="${window.location.origin}">BambooGrid</a>.</span>`,
    `</div>`,
    `<script async src="${window.location.origin}/embed.js"></script>`,
  ].join("\n");
}

function buildOembedUrl(sessionId: string): string {
  const embedUrl = encodeURIComponent(`${window.location.origin}/embed/${sessionId}`);
  return `${window.location.origin}/oembed?url=${embedUrl}&format=json`;
}

export function EmbedModal({ opened, onClose, sessionId, networkName }: Props) {
  const [theme, setTheme] = useState<EmbedTheme>("auto");
  const [controls, setControls] = useState(true);
  const [height, setHeight] = useState<number>(500);
  const [tab, setTab] = useState<string | null>("iframe");

  useEffect(() => {
    if (opened) setTab("iframe");
  }, [opened]);

  const code = useMemo(() => {
    if (!sessionId) return "";
    switch (tab) {
      case "iframe":
        return buildIframeCode(sessionId, networkName, theme, controls, height);
      case "html":
        return buildHtmlCode(sessionId, networkName, theme, controls, height);
      case "oembed":
        return buildOembedUrl(sessionId);
      default:
        return "";
    }
  }, [sessionId, networkName, theme, controls, height, tab]);

  const previewSrc = sessionId
    ? buildEmbedUrl(sessionId, theme, controls)
    : "";

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Embed This Scenario"
      size="lg"
      centered
      overlayProps={{ backgroundOpacity: 0.4, blur: 2 }}
    >
      <Stack gap="md">
        {/* Live preview */}
        {previewSrc && (
          <Box className="embed-preview-frame">
            <iframe
              src={previewSrc}
              title="Embed preview"
              style={{
                width: "100%",
                height: 220,
                border: "1px solid var(--mantine-color-default-border)",
                borderRadius: 8,
              }}
              sandbox="allow-scripts allow-same-origin"
              loading="lazy"
            />
          </Box>
        )}

        {/* Format tabs */}
        <Tabs value={tab} onChange={setTab}>
          <Tabs.List>
            <Tabs.Tab value="iframe">
              Iframe
              <Text component="span" size="xs" c="dimmed" ml={4}>
                (Recommended)
              </Text>
            </Tabs.Tab>
            <Tabs.Tab value="html">HTML</Tabs.Tab>
            <Tabs.Tab value="oembed">oEmbed</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="iframe" pt="sm">
            <Text size="xs" c="dimmed" mb="xs">
              Paste this snippet into any HTML page. Works on blogs, docs, CMS
              pages, and anywhere that allows iframes.
            </Text>
          </Tabs.Panel>
          <Tabs.Panel value="html" pt="sm">
            <Text size="xs" c="dimmed" mb="xs">
              Progressive-enhancement embed: shows a fallback link, then
              upgrades to an iframe via a small script. Useful when iframes
              aren't allowed directly (RSS feeds, some CMS editors).
            </Text>
          </Tabs.Panel>
          <Tabs.Panel value="oembed" pt="sm">
            <Text size="xs" c="dimmed" mb="xs">
              The oEmbed discovery URL for CMS platforms (WordPress, Notion,
              etc.) that auto-embed from a pasted link.
            </Text>
          </Tabs.Panel>
        </Tabs>

        {/* Options */}
        <Group grow gap="md">
          <Stack gap={4}>
            <Text size="xs" fw={500}>
              Theme
            </Text>
            <SegmentedControl
              size="xs"
              value={theme}
              onChange={(v) => setTheme(v as EmbedTheme)}
              data={[
                { label: "Auto", value: "auto" },
                { label: "Light", value: "light" },
                { label: "Dark", value: "dark" },
              ]}
            />
          </Stack>
          <Stack gap={4}>
            <Text size="xs" fw={500}>
              Controls
            </Text>
            <SegmentedControl
              size="xs"
              value={controls ? "on" : "off"}
              onChange={(v) => setControls(v === "on")}
              data={[
                { label: "On", value: "on" },
                { label: "Off", value: "off" },
              ]}
            />
          </Stack>
          {tab !== "oembed" && (
            <Stack gap={4}>
              <Text size="xs" fw={500}>
                Height (px)
              </Text>
              <NumberInput
                size="xs"
                value={height}
                onChange={(v) => setHeight(typeof v === "number" ? v : 500)}
                min={200}
                max={1200}
                step={50}
              />
            </Stack>
          )}
        </Group>

        {/* Code output */}
        <Box pos="relative">
          <Textarea
            value={code}
            readOnly
            autosize
            minRows={3}
            maxRows={10}
            styles={{
              input: {
                fontFamily: "monospace",
                fontSize: "var(--mantine-font-size-xs)",
              },
            }}
          />
          <CopyButton value={code} timeout={2000}>
            {({ copied, copy }) => (
              <Tooltip label={copied ? "Copied!" : "Copy code"} withArrow position="left">
                <ActionIcon
                  color={copied ? "teal" : "gray"}
                  variant="subtle"
                  onClick={copy}
                  style={{ position: "absolute", top: 6, right: 6 }}
                >
                  {copied ? <CheckIcon /> : <CopyIcon />}
                </ActionIcon>
              </Tooltip>
            )}
          </CopyButton>
        </Box>
      </Stack>
    </Modal>
  );
}

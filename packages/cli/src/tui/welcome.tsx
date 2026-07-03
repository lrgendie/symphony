import { Box, Text } from "ink";
import type { JSX } from "react";
import { PROTOCOL_VERSION, type ProviderHealth, type Usage } from "@symphony/shared";
import { LOGO_COLORS, LOGO_LINES, LOGO_TAGLINE } from "./logo.js";

/** index.ts'teki program.version ile aynı tutulur (kaynak: packages/cli/package.json). */
export const CLI_VERSION = "0.1.0";

/**
 * Oturum başlangıcı karşılaması (ROADMAP Faz 2.5): logo + sürüm + tarih +
 * sağlayıcı durumu + kalıcı kullanım özeti + kısayol ipuçları.
 * Claude Code'un açılış karşılamasının Symphony kimliğiyle karşılığı.
 */
export function Welcome(props: { providers: ProviderHealth[]; totals: Usage }): JSX.Element {
  const now = new Date();
  const date = now.toLocaleDateString("tr-TR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const time = now.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
  const totalTokens = props.totals.inputTokens + props.totals.outputTokens;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box flexDirection="column">
        {LOGO_LINES.map((line, i) => (
          <Text key={i} color={LOGO_COLORS[i % LOGO_COLORS.length]} bold>
            {line}
          </Text>
        ))}
      </Box>
      <Text dimColor>🎼 {LOGO_TAGLINE}</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>
          <Text bold>v{CLI_VERSION}</Text>
          <Text dimColor>
            {" "}
            · protokol v{PROTOCOL_VERSION} · {date} {time}
          </Text>
        </Text>
        <Text>
          {props.providers.map((provider) => (
            <Text key={provider.provider}>
              <Text color={provider.status === "up" ? "green" : "gray"}>
                {provider.status === "up" ? "●" : "○"}
              </Text>
              <Text dimColor={provider.status !== "up"}> {provider.provider} </Text>
            </Text>
          ))}
        </Text>
        <Text dimColor>
          toplam kullanım: {totalTokens.toLocaleString("tr-TR")} token · $
          {props.totals.costUsd.toFixed(4)}
        </Text>
        <Text dimColor>↑/↓ model · Enter seç · Esc cevabı iptal · Ctrl+C çıkış</Text>
      </Box>
    </Box>
  );
}

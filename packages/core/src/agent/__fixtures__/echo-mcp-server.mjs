// Test fixture: gerçek stdio MCP sunucusu (registerMcpServer testi için).
// Elle çalıştırılmaz; mcp.test.ts `node bu-dosya` ile alt süreç olarak başlatır.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "fixture-echo", version: "1.0.0" });
server.registerTool(
  "echo",
  { description: "Girdiyi geri döndürür.", inputSchema: { text: z.string() } },
  async ({ text }) => ({ content: [{ type: "text", text: `yankı: ${text}` }] }),
);

await server.connect(new StdioServerTransport());

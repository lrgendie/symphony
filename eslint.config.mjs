// Symphony kök ESLint yapılandırması — tüm paketler için geçerli.
// Kural felsefesi CLAUDE.md'de: strict TypeScript, `any` yasak.
import tseslint from "typescript-eslint";

export default tseslint.config(
  // target/ + gen/ = Rust/Tauri derleme çıktısı (packages/desktop); lint edilmez.
  { ignores: ["**/dist/**", "**/node_modules/**", "**/.turbo/**", "coverage/**", "**/target/**", "**/src-tauri/gen/**"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
);

import { afterEach, describe, expect, it } from "vitest";
import {
  CompositeSecretStore,
  EnvSecretStore,
  KeyringSecretStore,
  envVarNameFor,
  type KeyringEntry,
} from "./secret-store.js";

/** Gerçek OS keychain'ine dokunmayan bellek-içi sahte. */
function fakeKeyring(): {
  store: Map<string, string>;
  make: (s: string, a: string) => KeyringEntry;
} {
  const store = new Map<string, string>();
  return {
    store,
    make: (service, account) => ({
      getPassword: () => store.get(`${service}:${account}`) ?? null,
      setPassword: (pw) => void store.set(`${service}:${account}`, pw),
      deletePassword: () => store.delete(`${service}:${account}`),
    }),
  };
}

afterEach(() => {
  delete process.env["ANTHROPIC_API_KEY"];
});

describe("SecretStore", () => {
  it("provider adı doğru ortam değişkenine eşlenir", () => {
    expect(envVarNameFor("anthropic")).toBe("ANTHROPIC_API_KEY");
    expect(envVarNameFor("open-ai")).toBe("OPEN_AI_API_KEY");
  });

  it("EnvSecretStore okur ama yazamaz (salt okunur)", async () => {
    const env = new EnvSecretStore();
    expect(await env.get("anthropic")).toBeNull();
    process.env["ANTHROPIC_API_KEY"] = "sk-test";
    expect(await env.get("anthropic")).toBe("sk-test");
    await expect(env.set("anthropic", "x")).rejects.toThrow();
  });

  it("KeyringSecretStore yazar, okur, siler", async () => {
    const { make } = fakeKeyring();
    const store = new KeyringSecretStore(make);
    expect(await store.get("anthropic")).toBeNull();
    await store.set("anthropic", "sk-gizli");
    expect(await store.get("anthropic")).toBe("sk-gizli");
    await store.delete("anthropic");
    expect(await store.get("anthropic")).toBeNull();
  });

  it("Composite: keychain öncelikli, env yedek", async () => {
    const { make } = fakeKeyring();
    const store = new CompositeSecretStore(new KeyringSecretStore(make), new EnvSecretStore());
    process.env["ANTHROPIC_API_KEY"] = "sk-env";
    expect(await store.get("anthropic")).toBe("sk-env"); // keychain boş → env
    await store.set("anthropic", "sk-keychain");
    expect(await store.get("anthropic")).toBe("sk-keychain"); // keychain kazanır
  });
});

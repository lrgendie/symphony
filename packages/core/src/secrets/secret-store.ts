/**
 * SecretStore — API anahtarlarının TEK kapısı (ADR-010).
 * Anahtar asla dosyaya/loga yazılmaz; OS keychain'inde durur.
 * Keychain kullanılamıyorsa ortam değişkeni SALT OKUNUR yedek olarak devreye girer.
 */

export interface SecretStore {
  readonly backend: "keyring" | "env";
  get(provider: string): Promise<string | null>;
  set(provider: string, value: string): Promise<void>;
  delete(provider: string): Promise<void>;
}

/** `anthropic` → `ANTHROPIC_API_KEY` */
export function envVarNameFor(provider: string): string {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
}

export class EnvSecretStore implements SecretStore {
  readonly backend = "env" as const;

  async get(provider: string): Promise<string | null> {
    return process.env[envVarNameFor(provider)] ?? null;
  }

  async set(provider: string): Promise<void> {
    throw new Error(
      `Ortam değişkeni kasası salt okunur — ${envVarNameFor(provider)} değişkenini kendin ayarla ` +
        `veya OS keychain'inin kullanılabilir olduğundan emin ol.`,
    );
  }

  async delete(provider: string): Promise<void> {
    throw new Error(`Ortam değişkeni kasası salt okunur (${envVarNameFor(provider)}).`);
  }
}

/** @napi-rs/keyring Entry yüzeyi — testlerde sahte (in-memory) verilebilsin diye ayrık. */
export interface KeyringEntry {
  getPassword(): string | null;
  setPassword(password: string): void;
  deletePassword(): boolean;
}

const KEYRING_SERVICE = "symphony";

export class KeyringSecretStore implements SecretStore {
  readonly backend = "keyring" as const;

  constructor(private readonly makeEntry: (service: string, account: string) => KeyringEntry) {}

  async get(provider: string): Promise<string | null> {
    try {
      return this.makeEntry(KEYRING_SERVICE, provider).getPassword();
    } catch {
      // Kayıt yoksa bazı platformlar null yerine fırlatır — ikisi de "yok" demektir.
      return null;
    }
  }

  async set(provider: string, value: string): Promise<void> {
    this.makeEntry(KEYRING_SERVICE, provider).setPassword(value);
  }

  async delete(provider: string): Promise<void> {
    this.makeEntry(KEYRING_SERVICE, provider).deletePassword();
  }
}

/** Keychain öncelikli, ortam değişkeni yedekli birleşik kasa. */
export class CompositeSecretStore implements SecretStore {
  constructor(
    private readonly primary: SecretStore,
    private readonly fallback: SecretStore,
  ) {}

  get backend(): "keyring" | "env" {
    return this.primary.backend;
  }

  async get(provider: string): Promise<string | null> {
    return (await this.primary.get(provider)) ?? (await this.fallback.get(provider));
  }

  async set(provider: string, value: string): Promise<void> {
    await this.primary.set(provider, value);
  }

  async delete(provider: string): Promise<void> {
    await this.primary.delete(provider);
  }
}

/** Keychain varsa keyring+env birleşik; yoksa yalnız env (salt okunur) kasa döndürür. */
export async function createSecretStore(): Promise<SecretStore> {
  try {
    const { Entry } = await import("@napi-rs/keyring");
    return new CompositeSecretStore(
      new KeyringSecretStore((service, account) => new Entry(service, account)),
      new EnvSecretStore(),
    );
  } catch {
    return new EnvSecretStore();
  }
}

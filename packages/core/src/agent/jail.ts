import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { AgentError } from "./errors.js";

/**
 * Çalışma alanı hapsi (SPEC-AGENT.md §3): agent yalnız `cwd` ağacına
 * (+ agent.start'ta açıkça verilen extraDirs'e) dokunabilir. Her yol
 * `path.resolve` + realpath (symlink gerçek hedefine çözülür) + kök-kapsama
 * kontrolünden geçer; kaçış girişimi PERMISSION_JAIL fırlatır ve araç çalışmaz.
 */
export class WorkspaceJail {
  /** Birincil kök: agent.start.cwd (realpath'lenmiş). Göreli yollar buna göre çözülür. */
  readonly cwd: string;
  private readonly roots: readonly string[];

  constructor(cwd: string, extraDirs: string[] = []) {
    this.cwd = resolveRoot(cwd);
    this.roots = [this.cwd, ...extraDirs.map(resolveRoot)];
  }

  /**
   * İstenen yolu mutlak, symlink-çözülmüş hâle getirir; hapsin dışındaysa fırlatır.
   * Henüz var olmayan yollar (write_file yeni dosya) için var olan en derin ata
   * realpath'lenir, kalan kuyruk geri eklenir — symlink'le kaçış böylece kapanır.
   */
  resolve(requested: string): string {
    const absolute = path.resolve(this.cwd, requested);
    const real = resolveExistingPrefix(absolute);
    if (!this.roots.some((root) => contains(root, real))) {
      throw new AgentError("PERMISSION_JAIL", `Yol çalışma alanının dışında: ${requested}`, {
        requested,
        resolved: real,
      });
    }
    return real;
  }

  /** İzin desenleri ve özetler için: cwd'ye göreli, posix eğik çizgili yol. */
  relative(absolute: string): string {
    const rel = path.relative(this.cwd, absolute);
    return (rel === "" ? "." : rel).replaceAll("\\", "/");
  }
}

function resolveRoot(dir: string): string {
  let isDirectory = false;
  try {
    isDirectory = statSync(dir).isDirectory();
  } catch {
    throw new AgentError("AGENT_CWD_INVALID", `Çalışma dizini bulunamadı: ${dir}`);
  }
  if (!isDirectory) {
    throw new AgentError("AGENT_CWD_INVALID", `Çalışma dizini bir dizin değil: ${dir}`);
  }
  return realpathSync(dir);
}

/** Var olan en derin atayı realpath'ler, yaratılmamış kuyruğu geri ekler. */
function resolveExistingPrefix(absolute: string): string {
  let current = absolute;
  const tail: string[] = [];
  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return absolute; // kök bile yok (ör. olmayan sürücü)
    tail.unshift(path.basename(current));
    current = parent;
  }
  return path.join(realpathSync(current), ...tail);
}

/** target, root'un kendisi ya da altında mı? (win32'de büyük/küçük harf duyarsız) */
function contains(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  if (rel === "") return true;
  return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

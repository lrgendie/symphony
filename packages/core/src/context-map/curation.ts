/**
 * Bağlam Haritası kürasyonu — doğrulama çekirdeği (ADR-019 Karar 1/2, Faz "H" Dilim H1). SAF:
 * DB'ye dokunmaz; `lookup`/`exists` DAEMON'dan enjekte edilir (`store.mapNodeById`/`sessionDetail`/
 * `agentRunExists`in dar kesitleri — testte sahtelenir). Üç hata kodu (PROTOKOL.md'ye işli):
 * türetilmiş bir düğüme (proje/model/agent/hafta ya da gerçek bir oturum/koşu) dokunma girişimi
 * → PROTECTED (var ama kürasyon değil, değiştirilemez); hiçbir yerde karşılığı olmayan id →
 * UNKNOWN; `map.pin`in ref'i bilinmiyorsa → REF_UNKNOWN.
 */

export type MapCurationKind = "context" | "group";

/** Kürasyon düğüm arama — `store.mapNodeById`in dar kesiti. */
export type MapNodeLookupFn = (id: string) => { kind: MapCurationKind } | null;

/** Session/run varlığı — `store.sessionDetail`/`agentRunExists`in dar kesiti. */
export type MapRefExistsFn = (kind: "session" | "run", id: string) => boolean;

const DERIVED_ID_PREFIXES = ["project:", "model:", "agent:", "week:"] as const;

/** Sorgu-zamanında türetilen kararlı düğüm id'leri (proje/model/agent/hafta) — ASLA kürasyon değildir. */
export function isDerivedNodeId(id: string): boolean {
  return DERIVED_ID_PREFIXES.some((prefix) => id.startsWith(prefix));
}

/** id, grafta GERÇEKTEN var olan (türetilmiş ya da gerçek session/run) bir düğüme mi işaret ediyor? */
export function isKnownGraphReference(id: string, exists: MapRefExistsFn): boolean {
  return isDerivedNodeId(id) || exists("session", id) || exists("run", id);
}

export type MapValidationErrorCode =
  | "VALIDATION_MAP_NODE_UNKNOWN"
  | "VALIDATION_MAP_NODE_PROTECTED"
  | "VALIDATION_MAP_REF_UNKNOWN";

export type MapValidationResult = { ok: true } | { ok: false; code: MapValidationErrorCode };

/**
 * `map.node.rename`/`map.node.delete` hedefi: yalnız GERÇEK bir kürasyon düğümü (context/group)
 * kabul edilir. Türetilmiş/gerçek bir graf öğesiyse PROTECTED (var ama dokunulamaz); hiçbir
 * karşılığı yoksa UNKNOWN.
 */
export function checkCurationTarget(
  nodeId: string,
  lookup: MapNodeLookupFn,
  exists: MapRefExistsFn,
): MapValidationResult {
  if (lookup(nodeId) !== null) return { ok: true };
  if (isKnownGraphReference(nodeId, exists)) return { ok: false, code: "VALIDATION_MAP_NODE_PROTECTED" };
  return { ok: false, code: "VALIDATION_MAP_NODE_UNKNOWN" };
}

/**
 * `map.link.add`/`map.member.add`in uç noktası/nodeId'si: kürasyon düğümü YA DA türetilmiş/gerçek
 * bir graf öğesi olabilir — bağlamak silmekten farklıdır, var olan HERHANGİ bir düğüme bağ kurulabilir.
 */
export function checkGraphReference(
  id: string,
  lookup: MapNodeLookupFn,
  exists: MapRefExistsFn,
): MapValidationResult {
  if (lookup(id) !== null) return { ok: true };
  if (isKnownGraphReference(id, exists)) return { ok: true };
  return { ok: false, code: "VALIDATION_MAP_NODE_UNKNOWN" };
}

/** `map.member.add/remove`in `groupId`si TAM OLARAK bir `group` kürasyon düğümü olmalı. */
export function checkGroupTarget(groupId: string, lookup: MapNodeLookupFn): MapValidationResult {
  const node = lookup(groupId);
  if (node === null || node.kind !== "group") return { ok: false, code: "VALIDATION_MAP_NODE_UNKNOWN" };
  return { ok: true };
}

/** `map.pin`in ref'i: verildiyse GERÇEK bir session/run'a işaret etmeli. */
export function checkPinRef(
  ref: { kind: "session" | "run"; id: string } | undefined,
  exists: MapRefExistsFn,
): MapValidationResult {
  if (ref === undefined) return { ok: true };
  if (!exists(ref.kind, ref.id)) return { ok: false, code: "VALIDATION_MAP_REF_UNKNOWN" };
  return { ok: true };
}

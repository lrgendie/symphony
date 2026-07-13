/**
 * Bağlam haritası kürasyon eylemleri (ADR-019 Karar 2/6, Dilim H3) — SAF: bir düğüm türünde
 * detay panelinde HANGİ kürasyon düğmelerinin çıkacağını belirler. `ui` paketinde React bileşen
 * testi altyapısı YOK (jsdom/testing-library) — bu yüzden "hangi düğümde hangi buton" mantığı
 * `viewbox.ts`/`layout.ts` deseniyle bileşenden AYRILDI ki saf girdi/çıktı olarak test edilsin
 * (yanlış düğüme silme/sabitleme düğmesi koymak sinsi bir hata olurdu).
 */

export type CurationAction =
  | "pin" // Haritaya sabitle (map.pin) — türetilmiş session/run
  | "rename" // Yeniden adlandır (map.node.rename) — yalnız kürasyon
  | "delete" // Sil (map.node.delete) — yalnız kürasyon
  | "group" // Grupla (map.group.create) — bu düğümü içeren yeni grup
  | "link" // Bağla (map.link.add) — hedef seçme modu
  | "member-add" // Üye ekle (map.member.add) — grup düğümünde hedef seçme modu
  | "member-remove" // Kopar (map.member.remove) — grup düğümünde hedef seçme modu
  | "open-week"; // Haftayı aç (drill-down) — hafta düğümü

/**
 * Verilen düğüm türü için gösterilecek kürasyon eylemleri.
 * - session/run: türetilmiş ama sabitlenebilir + bağ/grup ucu olabilir (rename/delete YOK).
 * - project/model/agent: türetilmiş, KORUMALI (rename/delete/pin YOK) — yalnız bağ/grup ucu.
 * - context: kürasyon → tam yetki (pin HARİÇ; zaten sabitlenmiş bir düğüm).
 * - group: kürasyon → yeniden adlandır/sil + üye ekle/kopar + bağla.
 * - week: yalnız drill-down.
 * - bilinmeyen (ileri sürüm düğümü, Karar 7b): eylem yok (jenerik düğüm çizilir, kürasyon dışı).
 */
export function curationActionsFor(kind: string): CurationAction[] {
  switch (kind) {
    case "session":
    case "run":
      return ["pin", "link", "group"];
    case "project":
    case "model":
    case "agent":
      return ["link", "group"];
    case "context":
      return ["rename", "link", "group", "delete"];
    case "group":
      return ["rename", "member-add", "member-remove", "link", "delete"];
    case "week":
      return ["open-week"];
    default:
      return [];
  }
}

/** Kürasyon isteği hata kodunu kullanıcıya dönük Türkçe mesaja çevirir (sürüm sapması dahil). */
export function curationErrorMessage(result: { code: string; message: string }): string {
  switch (result.code) {
    case "VALIDATION_MAP_NODE_PROTECTED":
      return "Bu düğüm türetilmiş (proje/model/agent/hafta ya da gerçek bir oturum/koşu) — yeniden adlandırılamaz veya silinemez.";
    case "VALIDATION_MAP_NODE_UNKNOWN":
      return "Düğüm bulunamadı — harita eskimiş olabilir, yenilemeyi dene.";
    case "VALIDATION_MAP_REF_UNKNOWN":
      return "Sabitlenecek öğe bulunamadı.";
    default:
      // TIMEOUT / DISCONNECTED / VALIDATION_UNKNOWN_TYPE (eski daemon) zaten güncelleme ipucu taşır.
      return result.message;
  }
}

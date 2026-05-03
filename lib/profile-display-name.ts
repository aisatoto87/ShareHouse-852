export type SalutationMode = "chinese" | "english" | "nickname";

export const ZH_SUFFIX_OPTIONS = ["先生", "小姐", "女士"] as const;
export const EN_TITLE_OPTIONS = ["Mr.", "Ms.", "Mrs.", "Miss"] as const;

export function inferSalutationMode(
  displayName: string,
  lastZh: string,
  lastEn: string,
  nick: string
): SalutationMode {
  const dn = displayName.trim();
  if (!dn) return "chinese";
  const nz = nick.trim();
  if (nz && dn === nz) return "nickname";
  const zh = lastZh.trim();
  if (zh && dn.startsWith(zh)) return "chinese";
  const en = lastEn.trim();
  if (en) {
    const escaped = en.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const titleAlt = EN_TITLE_OPTIONS.map((t) => t.replace(/\./g, "\\.")).join("|");
    const re = new RegExp(`^(${titleAlt})\\s*${escaped}$`, "i");
    if (re.test(dn)) return "english";
  }
  return "chinese";
}

export function inferZhSuffix(displayName: string, lastZh: string): string {
  const zh = lastZh.trim();
  if (!zh || !displayName.startsWith(zh)) return "先生";
  const rest = displayName.slice(zh.length).trim();
  if (ZH_SUFFIX_OPTIONS.includes(rest as (typeof ZH_SUFFIX_OPTIONS)[number])) return rest;
  return "先生";
}

export function inferEnTitle(displayName: string, lastEn: string): string {
  const en = lastEn.trim();
  if (!en) return "Mr.";
  const idx = displayName.indexOf(en);
  if (idx <= 0) return "Mr.";
  const prefix = displayName.slice(0, idx).trim();
  if (EN_TITLE_OPTIONS.includes(prefix as (typeof EN_TITLE_OPTIONS)[number])) return prefix;
  return "Mr.";
}

export function assembleDisplayName(
  mode: SalutationMode,
  lastZh: string,
  zhSuffix: string,
  lastEn: string,
  enTitle: string,
  nick: string
): string {
  if (mode === "chinese") {
    const z = lastZh.trim();
    if (!z) return "";
    return `${z}${zhSuffix.trim() || "先生"}`;
  }
  if (mode === "english") {
    const e = lastEn.trim();
    if (!e) return "";
    return `${enTitle.trim()} ${e}`.replace(/\s+/g, " ").trim();
  }
  return nick.trim();
}

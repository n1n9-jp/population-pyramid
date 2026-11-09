import { DATA_PATH, FIXTURE_PATH, GROUPS } from "./config.js";

export async function loadData(useFixture) {
  if (typeof window.d3 === "undefined") {
    throw new Error("d3 を読み込めませんでした。ネットワーク接続を確認してください。");
  }
  const url = useFixture ? FIXTURE_PATH : DATA_PATH;
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    const hint = location.protocol === "file:"
      ? "file:// で開くとデータを読めません。リポジトリ直下で python3 -m http.server 8000 を実行し、http://localhost:8000/regions.html を開いてください。"
      : "ネットワーク接続を確認してください。";
    throw new Error(`データ（${url}）を読み込めませんでした。${hint}`);
  }
  if (!res.ok) throw new Error(`データ（${url}）を読み込めませんでした（HTTP ${res.status}）。`);
  const data = await res.json();
  derive(data);
  return data;
}

/** 描画で何度も使う値（割合・65歳以上の割合）を一度だけ計算する。 */
function derive(data) {
  data.yearIndexOf = new Map(data.years.map((y, i) => [y, i]));
  data.yearInfo = data.years.map((year) => ({ year, ...data.yearMeta[String(year)] }));
  data.shares = {};
  for (const [key, perYear] of Object.entries(data.series)) {
    data.shares[key] = data.years.map((year) => {
      const e = perYear[String(year)];
      if (e.missing) return { missing: true, total: 0, open: e.openIndex, m: null, f: null, pct65: null };
      const sum = (a) => a.reduce((s, v) => s + (v ?? 0), 0);
      const den = sum(e.male) + sum(e.female);
      const toShare = (a) => a.map((v) => (v == null ? null : v / den));
      return {
        missing: false, total: e.total, open: e.openIndex,
        m: toShare(e.male), f: toShare(e.female),
        pct65: (sum(e.male.slice(13)) + sum(e.female.slice(13))) / den,
      };
    });
  }
  data.facets = {
    prefecture: data.areas.map((a) => ({ id: a.code, name: a.short, full: a.name, tile: a.tile })),
    block: data.blocks.map((b) => ({ id: b.id, name: b.name, full: b.name, tile: b.tile })),
  };
  if (data.ageGroups.length !== GROUPS) throw new Error("ageGroups の長さが不正です。");
}

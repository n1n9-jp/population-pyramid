import { DATA_PATH, FIXTURE_PATH } from "./config.js";

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
      ? "file:// で開くとデータを読めません。リポジトリ直下で python3 -m http.server 8000 を実行し、http://localhost:8000/ を開いてください。"
      : "ネットワーク接続を確認してください。";
    throw new Error(`データ（${url}）を読み込めませんでした。${hint}`);
  }
  if (!res.ok) throw new Error(`データ（${url}）を読み込めませんでした（HTTP ${res.status}）。`);
  const data = await res.json();
  data.byYear = new Map(data.years.map((y) => [y.year, y]));
  return data;
}

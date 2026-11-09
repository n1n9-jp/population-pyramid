const ERAS = [
  { name: "令和", start: "2019-05-01", y0: 2019 },
  { name: "平成", start: "1989-01-08", y0: 1989 },
  { name: "昭和", start: "1926-12-25", y0: 1926 },
  { name: "大正", start: "1912-07-30", y0: 1912 },
  { name: "明治", start: "1868-01-25", y0: 1868 },
];

const num = (v) => Math.round(v).toLocaleString("en-US");

/** refDate（YYYY-MM-DD）時点の元号表記。年をまたぐ年は調査日時点の元号。 */
export function wareki(refDate) {
  const year = Number(refDate.slice(0, 4));
  const era = ERAS.find((e) => refDate >= e.start) || ERAS[ERAS.length - 1];
  const n = year - era.y0 + 1;
  return `${era.name}${n === 1 ? "元" : n}年`;
}

export function refDayText(refDate) {
  const [, m, d] = refDate.split("-").map(Number);
  return `${m}月${d}日`;
}

export function yearMetaText(y, basisLabels) {
  return `${refDayText(y.refDate)}現在・${basisLabels[y.basis] || y.basis}`;
}

export function ariaValueText(y) {
  return `${y.year}年（${y.kazoe ? "数え年・" : ""}${refDayText(y.refDate)}現在）`;
}

export function formatPersons(v, precision) {
  if (precision === 1) return `${num(v)}人`;
  if (v >= 1e4) return `${(v / 1e4).toFixed(1)}万人`;
  return `${num(v)}人`;
}

export function formatTotal(v) {
  const man = Math.round(v / 1e4);
  const oku = Math.floor(man / 1e4);
  const rest = man % 1e4;
  if (oku > 0) return rest === 0 ? `${oku}億人` : `${oku}億${num(rest)}万人`;
  return `${num(rest)}万人`;
}

export function ageHeading(y, age) {
  const k = y.kazoe ? "数え年" : "";
  return age === y.openAge ? `${k}${y.openAge}歳以上` : `${k}${age}歳`;
}

export function birthText(y, age) {
  const Y = y.year;
  if (y.kazoe) {
    return age >= y.openAge ? `${Y - y.openAge + 1}年以前生まれ` : `${Y - age + 1}年生まれ`;
  }
  return age >= y.openAge
    ? `${Y - y.openAge}年9月以前生まれ`
    : `${Y - age - 1}年10月〜${Y - age}年9月生まれ`;
}

export function nullReason(y, age) {
  if (age > y.openAge) return `この年は${y.openAge}歳以上にまとめて表示`;
  return "数え年のため0歳はありません";
}

export function ageLabel(y, age) {
  return age === y.openAge ? `${age}歳以上` : `${age}歳`;
}

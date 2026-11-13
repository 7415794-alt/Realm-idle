// 큰 숫자 / 시간 포맷 유틸
const SUFFIX = ['', 'K', 'M', 'B', 'T'];

export function fmt(n) {
  if (n === undefined || n === null || Number.isNaN(n)) return '0';
  if (!Number.isFinite(n)) return '∞';
  if (n < 0) return '-' + fmt(-n);
  // 1000조 미만은 단위 없이 숫자 그대로 (쉼표, 소수점은 올림)
  if (n < 1e15) return Math.ceil(n - 1e-9).toLocaleString('ko-KR');
  const e = Math.floor(Math.log10(n) / 3);
  let suf;
  if (e < SUFFIX.length) {
    suf = SUFFIX[e];
  } else {
    // aa, ab, ac ... zz
    const k = e - SUFFIX.length;
    suf = String.fromCharCode(97 + (Math.floor(k / 26) % 26)) + String.fromCharCode(97 + (k % 26));
  }
  const v = n / Math.pow(10, e * 3);
  const s = v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : Math.floor(v).toString();
  return s + suf;
}

export function fmtPct(x, digits = 0) {
  return (x * 100).toFixed(digits) + '%';
}

export function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}시간 ${m}분`;
  if (m > 0) return `${m}분 ${s}초`;
  return `${s}초`;
}

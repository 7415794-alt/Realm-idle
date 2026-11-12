// 저장 데이터 구조 / 저장 · 불러오기
const KEY = 'aether-expedition-save-v1';

export function newState() {
  return {
    v: 1,
    gold: 0,
    essence: 0,
    stage: 1,
    maxStage: 1,
    runMaxStage: 1,
    kills: 0,
    autoAdvance: true,
    hero: { atk: 1, hp: 1, speed: 0, crit: 0, critDmg: 0, goldUp: 0 },
    comps: {},
    relics: {},
    equip: { weapon: null, armor: null, accessory: null },
    inv: [],
    nextId: 1,
    autoSkill: false,
    settings: { autoEquip: true, autoSell: 0, buyMult: 1 },
    stats: {
      kills: 0, bossKills: 0, goldEarned: 0, prestiges: 0, playTime: 0,
      essenceEarned: 0, taps: 0, items: 0,
    },
    lastSeen: Date.now(),
  };
}

function isObj(x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

// 기본값 위에 저장값을 덮어씀 (버전 업데이트로 새 필드가 생겨도 안전)
function merge(def, src) {
  if (src === undefined) return def;
  if (isObj(def) && isObj(src)) {
    const out = { ...def };
    for (const k of Object.keys(src)) out[k] = merge(def[k], src[k]);
    return out;
  }
  if (typeof def === 'number' && (typeof src !== 'number' || !Number.isFinite(src))) return def;
  return src;
}

export function hydrate(obj) {
  return merge(newState(), obj);
}

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return hydrate(JSON.parse(raw));
  } catch (e) {
    console.warn('세이브 불러오기 실패', e);
    return null;
  }
}

export function saveState(state) {
  state.lastSeen = Date.now();
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    console.warn('저장 실패', e);
    return false;
  }
}

export function clearState() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
}

export function exportState(state) {
  const json = JSON.stringify(state);
  return btoa(unescape(encodeURIComponent(json)));
}

export function importState(str) {
  const json = decodeURIComponent(escape(atob(str.trim())));
  const obj = JSON.parse(json);
  if (!isObj(obj) || typeof obj.stage !== 'number') throw new Error('잘못된 세이브 코드');
  return hydrate(obj);
}

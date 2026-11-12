// 저장 데이터 구조 / 저장 · 불러오기
import { newLifeState } from './life.js';
import { newWorldState } from './world.js';

const KEY = 'aether-expedition-save-v1';

export const SAVE_VERSION = 3;

export function newState() {
  return {
    v: SAVE_VERSION,
    gold: 0,
    stage: 1,         // 지금 대상 몬스터 레벨
    maxStage: 1,      // 처치한 몬스터 최고 레벨
    target: { z: 0, mi: 0 }, // 지도에서 고른 몬스터 (z 지역, mi 0~4 일반 · 5 보스)
    maxZone: 0,       // 열린 지역 중 가장 높은 번호
    bestiary: {},     // 몬스터별 처치 수 ('z_mi')
    // 시작 장비: 청동 한손검 · 청동 갑옷
    equip: {
      weapon: { id: 1, slot: 'weapon', kind: 'sword', r: 0, lvl: 1, enh: 0 },
      shield: null, helm: null,
      body: { id: 2, slot: 'body', r: 0, lvl: 1, enh: 0 },
      legs: null, gloves: null, boots: null, amulet: null, ring1: null, ring2: null, cape: null, off: null,
    },
    inv: [],
    nextId: 3,
    autoSkill: false,
    settings: { autoEquip: true, autoSell: 0, speed: 1, autoProgress: true, autoCombine: false },
    life: newLifeState(),
    world: newWorldState(),
    stats: {
      kills: 0, bossKills: 0, goldEarned: 0, playTime: 0, deaths: 0, taps: 0, items: 0, bestRarity: 0,
    },
    lastSeen: Date.now(),
  };
}

// v1(골드 강화 · 동료 · 환생) → v2(장비 중심) 변환
const OLD_SLOT = { weapon: 'weapon', armor: 'body', accessory: 'amulet' };
function convertItem(it) {
  if (!isObj(it)) return null;
  const slot = OLD_SLOT[it.slot] || it.slot;
  const out = { id: it.id, slot, r: Math.min(4, it.r || 0), lvl: it.lvl || 1, enh: it.enh || 0 };
  if (slot === 'weapon') out.kind = it.kind || 'sword';
  return out;
}
function migrate(obj) {
  if (!isObj(obj)) return obj;
  if ((obj.v || 1) < 2) obj = migrateV1(obj);
  if (obj.v < 3) obj = migrateV2(obj);
  return obj;
}
// v2(스테이지 진행) → v3(지도에서 몬스터 선택): 도달한 스테이지의 지역까지 열고, 그 위치의 몬스터를 대상으로
function migrateV2(obj) {
  const o = { ...obj, v: 3 };
  const st = Math.max(1, o.stage || 1);
  const ms = Math.max(st, o.maxStage || 1);
  o.maxZone = Math.floor((ms - 1) / 10);
  const z = Math.floor((st - 1) / 10);
  o.target = { z, mi: Math.min(4, Math.floor(((st - 1) % 10) / 2)) };
  o.stage = z * 10 + 1 + 2 * o.target.mi;
  delete o.kills;
  delete o.autoAdvance;
  return o;
}
function migrateV1(obj) {
  const o = { ...obj, v: 2 };
  const eq = {};
  for (const [k, it] of Object.entries(obj.equip || {})) {
    const c = convertItem(it);
    if (c) eq[c.slot] = c;
  }
  o.equip = eq;
  o.inv = (obj.inv || []).map(convertItem).filter(Boolean);
  // 전투 체계가 바뀌어 스테이지 1부터 다시 시작 (최고 스테이지 · 장비 · 생활 스킬 유지)
  o.stage = 1;
  o.kills = 0;
  o.autoAdvance = true;
  for (const k of ['hero', 'comps', 'relics', 'essence', 'runMaxStage']) delete o[k];
  return o;
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
  const st = merge(newState(), migrate(obj));
  delete st.hero; delete st.comps; delete st.relics; delete st.essence;
  // 지도 대상이 잘못돼도 안전하게
  const tg = st.target;
  if (!(tg.z >= 0 && tg.z <= st.maxZone && tg.mi >= 0 && tg.mi <= 5)) st.target = { z: 0, mi: 0 };
  // 장비 id 중복 정리 (시작 장비와 옛 장비가 겹치는 경우)
  const seen = new Set();
  const all = [...Object.values(st.equip).filter(Boolean), ...st.inv];
  st.nextId = Math.max(st.nextId, ...all.map((it) => (it.id || 0) + 1));
  for (const it of all) {
    if (!it.id || seen.has(it.id)) it.id = st.nextId++;
    seen.add(it.id);
  }
  return st;
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

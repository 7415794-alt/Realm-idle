// 저장 데이터 구조 / 저장 · 불러오기
import { newLifeState } from './life.js';
import { newWorldState } from './world.js';
import { WEAPONS, potValue } from './data.js';

const KEY = 'aether-expedition-save-v1';

export const SAVE_VERSION = 7;

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
    settings: { autoEquip: true, autoSell: 0, sellLower: true, autoMuseum: false, speed: 1, autoProgress: true, autoCombine: false, style: 'melee' },
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
  if (obj.v < 4) obj = migrateV3(obj);
  if (obj.v < 5) obj = migrateV4(obj);
  if (obj.v < 6) obj = migrateV5(obj);
  if (obj.v < 7) obj = migrateV6(obj);
  return obj;
}
// v3 → v4: 전투 스킬 제거, 전투 방식을 직접 선택 (지금 무기의 방식으로 시작)
// v6 → v7: 골드 1/100, 장비 레벨을 단계(재질)로 맞춤, 칸 강화 최대 99 · 하위 장비 자동 판매
function migrateV6(obj) {
  const o = { ...obj, v: 7 };
  o.gold = (o.gold || 0) / 100;
  o.settings = { ...(o.settings || {}), sellLower: true };
  const snap = (lvl) => Math.floor((Math.max(1, lvl || 1) - 1) / 10) * 10 + 5;
  for (const it of [...Object.values(o.equip || {}), ...(o.inv || [])]) if (it) it.lvl = snap(it.lvl);
  return o;
}
// v5(장비별 강화 · 잠재능력) → v6(장비칸 강화 · 잠재능력): 착용 장비의 것을 그 칸으로 옮김, 가방 장비의 것은 사라짐
const SLOT_KEYS = ['enh', 'pot', 'potNew', 'pity', 'potLock'];
function migrateV5(obj) {
  const o = { ...obj, v: 6 };
  o.slots = {};
  for (const [sl, it] of Object.entries(o.equip || {})) {
    if (!it) continue;
    const d = { enh: it.enh || 0 };
    for (const k of SLOT_KEYS.slice(1)) if (it[k] !== undefined) d[k] = it[k];
    o.slots[sl] = d;
  }
  for (const it of [...Object.values(o.equip || {}), ...(o.inv || [])]) {
    if (!it) continue;
    it.enh = 0;
    for (const k of SLOT_KEYS.slice(1)) delete it[k];
  }
  return o;
}
// v4(잠재능력 4등급) → v5(21등급): 레어 · 에픽 · 유니크 · 레전드리 → 희귀 · 영웅 · 전설 · 신화, 수치는 새 표로
function migrateV4(obj) {
  const o = { ...obj, v: 5 };
  const conv = (p) => {
    if (!p) return p;
    const t = [2, 3, 4, 5][p.t] ?? 2;
    return { t, lines: p.lines.map(([k], i) => [k, potValue(k, i === 0 ? t : t - 1)]) };
  };
  for (const it of [...Object.values(o.equip || {}), ...(o.inv || [])]) {
    if (!it) continue;
    if (it.pot) it.pot = conv(it.pot);
    if (it.potNew) it.potNew = conv(it.potNew);
  }
  return o;
}
function migrateV3(obj) {
  const o = { ...obj, v: 4 };
  o.settings = { ...(o.settings || {}), style: WEAPONS[o.equip?.weapon?.kind]?.style || 'melee' };
  delete o.autoSkill;
  return o;
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

// 붙여넣는 과정에서 끼어든 줄바꿈 · 공백 · 따옴표 등을 지우고 읽음 (메모 앱 · 메신저를 거쳐도 동작)
export function importState(str) {
  const raw = String(str || '').trim();
  if (!raw) throw new Error('세이브 코드가 비어 있습니다');
  let obj = null;
  if (raw.startsWith('{')) {
    try { obj = JSON.parse(raw); } catch (e) { /* 아래에서 다시 시도 */ }
  }
  if (!obj) {
    let b = raw.replace(/[^A-Za-z0-9+/=_-]/g, '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
    while (b.length % 4) b += '=';
    let json;
    try { json = decodeURIComponent(escape(atob(b))); } catch (e) {
      throw new Error(`코드를 읽을 수 없습니다 (${raw.replace(/\s+/g, '').length}자). 코드가 중간에 잘렸거나 일부가 바뀐 것 같습니다`);
    }
    try { obj = JSON.parse(json); } catch (e) {
      throw new Error(`코드가 끝까지 복사되지 않았습니다 (${raw.replace(/\s+/g, '').length}자). 처음부터 끝까지 전부 복사해 주세요`);
    }
  }
  if (!isObj(obj) || typeof obj.stage !== 'number') throw new Error('이 게임의 세이브 코드가 아닙니다');
  return hydrate(obj);
}

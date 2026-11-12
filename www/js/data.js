// 게임 밸런스 / 콘텐츠 데이터
import { fmt } from './format.js';

export const GAME_NAME = '에테르 원정기';
export const VERSION = '2.1.0';

// ---- 전투 / 스테이지 ----
export const STAGE_KILLS = 10;      // 보스 등장까지 처치 수
export const BOSS_TIME = 30;        // 보스 제한 시간(초)
export const RESPAWN = 0.35;        // 몬스터 재등장 시간
export const HERO_REVIVE = 4;       // 영웅 부활 시간
export const INV_MAX = 60;          // 가방 칸 수
export const OFFLINE_CAP = 6 * 3600; // 오프라인 최대 시간(초)

// 성장 곡선: 몬스터가 장비보다 조금 더 빨리 강해짐 → 높은 등급 · 강화 · 제작이 필요
export const power = (lvl) => Math.pow(1.12, Math.max(1, lvl) - 1);
export const MON_GROWTH = 1.135;
export const monPower = (stage) => Math.pow(MON_GROWTH, Math.max(1, stage) - 1);
export const goldPerKill = (s) => 2 * Math.pow(1.13, s - 1);
export const isZoneBoss = (s) => s % 10 === 0;
export const bossGoldMult = (s) => (isZoneBoss(s) ? 15 : 6);

// 몬스터 능력치 (hp: 체력, def: 방어, str: 힘 → 받는 피해)
export function monsterStats(stage, kind = 'normal') {
  const p = monPower(stage);
  const ease = Math.min(1, 0.45 + 0.055 * (stage - 1)); // 초반 10스테이지 완화
  const m = { hp: 40 * p * ease, def: 5 * p, str: 26 * p * ease, interval: 2 };
  if (kind === 'boss') { m.hp *= 6; m.def *= 1.3; m.str *= 1.3; }
  if (kind === 'zoneBoss') { m.hp *= 10; m.def *= 1.5; m.str *= 1.6; m.interval = 1.8; }
  return m;
}

// ---- 전투 공식 ----
export const HERO_BASE = { atk: 5, str: 5, def: 0, hp: 100, crit: 0.05 };
export const CRIT_MULT = 1.5;
export const BASE_MIN_HIT = 0.15;   // 최소 피해 = 최대 피해의 15% (+무기 보너스)
// 한 방 최대 피해: (공격 + 힘) x 0.85 - 몬스터 방어 x 0.3
export const maxHitVs = (atk, str, mDef) => Math.max(1, (atk + str) * 0.85 - mDef * 0.3);
// 받는 피해: 몬스터 힘 x 0.58 x (1 - 방어 효율), 최소 몬스터 힘의 4%
export function incomingHit(mStr, def) {
  const eff = (def * 0.25) / (def * 0.25 + 100 + mStr * 0.2);
  return Math.max(mStr * 0.04, mStr * 0.58 * (1 - eff));
}
export const defEfficiency = (def, mStr) => (def * 0.25) / (def * 0.25 + 100 + mStr * 0.2);

// ---- 지역 ----
export const ZONES = [
  {
    name: '고요한 숲', sky: ['#8fd3f4', '#e2f7d4'], hill: '#6fae5a', ground: '#4c8a3a',
    monsters: [['🐛', '애벌레'], ['🐀', '들쥐'], ['🐌', '독달팽이'], ['🦔', '가시고슴도치'], ['🐍', '풀뱀']],
    boss: ['🐗', '멧돼지 우두머리'],
  },
  {
    name: '안개 늪', sky: ['#7b8d99', '#c4d1bd'], hill: '#5a7563', ground: '#3d5a46',
    monsters: [['🐸', '늪개구리'], ['🦟', '흡혈모기'], ['🦎', '늪도마뱀'], ['🍄', '걷는 버섯'], ['🐢', '이끼거북']],
    boss: ['🐊', '늪의 군주'],
  },
  {
    name: '바위 협곡', sky: ['#f6c48a', '#f7e3c3'], hill: '#b07a4f', ground: '#8a5b38',
    monsters: [['🦂', '협곡전갈'], ['🦅', '바위독수리'], ['🐺', '회색늑대'], ['🦬', '성난 들소'], ['🕷️', '동굴거미']],
    boss: ['🦍', '협곡의 폭군'],
  },
  {
    name: '화염 동굴', sky: ['#3a0d0d', '#a8341c'], hill: '#5e1a12', ground: '#2e0f0b',
    monsters: [['🔥', '불도깨비'], ['🦇', '용암박쥐'], ['🦖', '화염 랩터'], ['👺', '화염 요괴'], ['🦀', '용암게']],
    boss: ['🐉', '화염룡'],
  },
  {
    name: '얼음 성채', sky: ['#a9d6ff', '#f0f8ff'], hill: '#c8e2f5', ground: '#9cc3de',
    monsters: [['⛄', '서리 정령'], ['🐧', '빙하 펭귄'], ['🦭', '얼음 바다표범'], ['🐻‍❄️', '설원곰'], ['🧊', '얼음 골렘']],
    boss: ['🦣', '고대 매머드'],
  },
  {
    name: '그림자 왕국', sky: ['#1b1530', '#4a3a6b'], hill: '#2d2445', ground: '#1a1428',
    monsters: [['👻', '망령'], ['💀', '해골 병사'], ['🧟', '구울'], ['🦉', '밤부엉이'], ['🧛', '흡혈귀']],
    boss: ['👹', '그림자 군주'],
  },
  {
    name: '천공의 섬', sky: ['#5ec2ff', '#fff6d6'], hill: '#ffffff', ground: '#7fc06b',
    monsters: [['🌪️', '폭풍 정령'], ['🦜', '천둥새'], ['🐝', '거대 벌'], ['🦋', '환영나비'], ['☁️', '구름 골렘']],
    boss: ['🌩️', '폭풍의 화신'],
  },
  {
    name: '심연의 바다', sky: ['#021b3a', '#0d5a7a'], hill: '#083049', ground: '#0a2235',
    monsters: [['🐙', '심연 문어'], ['🦑', '대왕오징어'], ['🦈', '그림자 상어'], ['🐡', '독복어'], ['🐚', '껍질괴물']],
    boss: ['🐋', '심연의 고래'],
  },
];

const ROMAN = ['', ' II', ' III', ' IV', ' V', ' VI', ' VII', ' VIII', ' IX', ' X'];
export function zoneOf(stage) {
  const idx = Math.floor((stage - 1) / 10);
  const zone = ZONES[idx % ZONES.length];
  const cycle = Math.floor(idx / ZONES.length);
  return { ...zone, title: zone.name + (ROMAN[cycle] ?? ` ${cycle + 1}`) };
}

// ---- 스킬 ----
export const SKILLS = [
  { id: 'strike', icon: '⚔️', name: '일격필살', unlock: 5, cd: 12, dur: 0, desc: '최대 피해의 8배로 일격' },
  { id: 'frenzy', icon: '🔥', name: '광폭화', unlock: 15, cd: 45, dur: 12, desc: '12초간 공격 속도 x2' },
  { id: 'fortify', icon: '🛡️', name: '철벽', unlock: 25, cd: 60, dur: 15, desc: '15초간 받는 피해 -50%' },
  { id: 'midas', icon: '💰', name: '황금비', unlock: 35, cd: 90, dur: 20, desc: '20초간 골드 획득 x3' },
];

// ---- 장비 등급 (21단계) ----
// mult: 능력치 배율, w: 드롭 가중치
export const RARITIES = [
  { name: '일반', color: '#b8b8b8', mult: 1.0, w: 1 },
  { name: '고급', color: '#5fd35f', mult: 1.12, w: 0.4 },
  { name: '희귀', color: '#4da3ff', mult: 1.25, w: 0.17 },
  { name: '영웅', color: '#c37bff', mult: 1.4, w: 0.08 },
  { name: '전설', color: '#ffa63d', mult: 1.6, w: 0.035 },
  { name: '신화', color: '#ff5e7e', mult: 1.8, w: 0.016 },
  { name: '태고', color: '#d4b483', mult: 2.05, w: 7e-3 },
  { name: '별빛', color: '#9fd8ff', mult: 2.3, w: 3e-3 },
  { name: '월광', color: '#c9d6ff', mult: 2.6, w: 1.3e-3 },
  { name: '일식', color: '#ff8c42', mult: 2.9, w: 5.5e-4 },
  { name: '서리불꽃', color: '#7ee8fa', mult: 3.25, w: 2.3e-4 },
  { name: '폭풍', color: '#8ab4ff', mult: 3.6, w: 1e-4 },
  { name: '용혼', color: '#ff4040', mult: 4.0, w: 4e-5 },
  { name: '천둥왕', color: '#ffe14d', mult: 4.45, w: 1.7e-5 },
  { name: '성광', color: '#fff6b0', mult: 4.95, w: 7e-6 },
  { name: '공허', color: '#9b6bff', mult: 5.5, w: 3e-6 },
  { name: '영겁', color: '#5ef0c0', mult: 6.1, w: 1.3e-6 },
  { name: '천상', color: '#bfe9ff', mult: 6.8, w: 5e-7 },
  { name: '초월', color: '#ff9cf2', mult: 7.5, w: 2e-7 },
  { name: '창세', color: '#9effa8', mult: 8.3, w: 8e-8 },
  { name: '에테르', color: '#ffffff', mult: 9.2, w: 3e-8 },
];
const RARITY_TOTAL = RARITIES.reduce((a, r) => a + r.w, 0);

// 등급 굴림: luck번 굴려 가장 높은 등급 (보스일수록 luck이 큼)
export function rollRarity(luck = 1, rnd = Math.random) {
  let best = 0;
  for (let i = 0; i < luck; i++) {
    let x = rnd() * RARITY_TOTAL;
    let r = 0;
    for (; r < RARITIES.length - 1; r++) {
      x -= RARITIES[r].w;
      if (x < 0) break;
    }
    if (r > best) best = r;
  }
  return best;
}

// ---- 장비 ----
// 재질: 아이템 레벨 10마다 한 단계
export const MATERIALS = ['청동', '철', '강철', '은강', '미스릴', '아다만', '룬', '용린', '별철', '에테르', '공허', '태초'];
export const materialOf = (lvl) => MATERIALS[Math.min(MATERIALS.length - 1, Math.floor((Math.max(1, lvl) - 1) / 10))];

// 부위별 기본 능력치 (레벨 1 · 일반 기준). crit은 성장하지 않고 등급 배율만 받음
export const SLOTS = {
  weapon: { name: '무기', icon: '🗡️' },
  shield: { name: '방패', icon: '🛡️', noun: '방패', stats: { def: 8, hp: 20 } },
  helm: { name: '투구', icon: '⛑️', noun: '투구', stats: { def: 5, hp: 10 } },
  body: { name: '갑옷', icon: '🥋', noun: '갑옷', stats: { def: 12, hp: 30 } },
  legs: { name: '각반', icon: '👖', noun: '각반', stats: { def: 9, hp: 20 } },
  gloves: { name: '장갑', icon: '🧤', noun: '장갑', stats: { atk: 3, crit: 0.02 } },
  boots: { name: '장화', icon: '👢', noun: '장화', stats: { def: 3, hp: 10 } },
  amulet: { name: '목걸이', icon: '📿', noun: '목걸이', stats: { str: 5, crit: 0.02 } },
  cape: { name: '망토', icon: '🧣', noun: '망토', stats: { def: 4, hp: 15 } },
};
export const SLOT_IDS = Object.keys(SLOTS);

// 무기 종류: 한손검(최소 피해↑) · 장검(힘↑) · 양손검(강력하지만 방패 불가, 느림)
export const WEAPONS = {
  sword: { noun: '한손검', stats: { atk: 10 }, minHit: 0.1, speed: 1.0 },
  blade: { noun: '장검', stats: { atk: 9, str: 4 }, minHit: 0, speed: 0.95 },
  great: { noun: '양손검', stats: { atk: 17, str: 8 }, minHit: 0, speed: 0.75, twoHand: true },
};
export const WEAPON_IDS = Object.keys(WEAPONS);

export const STAT_NAMES = { atk: '공격', str: '힘', def: '방어', hp: '체력', crit: '치명타' };
export const ENHANCE_MAX = 10;

export function baseStats(it) {
  return it.slot === 'weapon' ? WEAPONS[it.kind || 'sword'].stats : SLOTS[it.slot].stats;
}

// 장비 최종 능력치
export function itemStats(it) {
  const out = {};
  const m = RARITIES[it.r].mult * (1 + 0.1 * (it.enh || 0));
  const p = power(it.lvl);
  for (const [k, v] of Object.entries(baseStats(it))) out[k] = k === 'crit' ? v * RARITIES[it.r].mult : v * p * m;
  return out;
}

// 비교용 점수 (공격·힘 > 방어 > 체력)
export function itemScore(it) {
  if (!it) return 0;
  const st = itemStats(it);
  return (st.atk || 0) + (st.str || 0) + (st.def || 0) * 0.5 + (st.hp || 0) * 0.15 + (st.crit || 0) * 30 * power(it.lvl);
}

export const itemName = (it) => {
  const noun = it.slot === 'weapon' ? WEAPONS[it.kind || 'sword'].noun : SLOTS[it.slot].noun;
  return `${materialOf(it.lvl)} ${noun}` + (it.enh > 0 ? ` +${it.enh}` : '');
};
export const itemSellPrice = (it) => goldPerKill(it.lvl) * 2 * RARITIES[it.r].mult * (1 + (it.enh || 0) * 0.5);
export const enhanceCost = (it) => goldPerKill(it.lvl) * 15 * Math.pow(1.55, it.enh || 0);

export function statText(st) {
  return Object.entries(st).map(([k, v]) => `${STAT_NAMES[k]} ${k === 'crit' ? (v * 100).toFixed(1) + '%' : fmt(v)}`).join(' · ');
}

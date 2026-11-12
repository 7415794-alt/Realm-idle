// 게임 밸런스 / 콘텐츠 데이터
import { fmt } from './format.js';

export const GAME_NAME = '에테르 원정기';
export const VERSION = '3.0.0';
// VIP: 원래 유료 등급이지만 모든 플레이어에게 무료로 최고 등급(VIP++) 적용
export const VIP = { name: 'VIP++', mult: 1.75, label: '+75%' };

// ---- 전투 / 스테이지 ----
export const STAGE_KILLS = 10;      // 보스 등장까지 처치 수
export const BOSS_TIME = 30;        // 보스 제한 시간(초)
export const RESPAWN = 0.35;        // 몬스터 재등장 시간
export const HERO_REVIVE = 4;       // 영웅 부활 시간
export const INV_MAX = 60;          // 가방 칸 수
export const OFFLINE_CAP = 6 * 3600; // 오프라인 최대 시간(초)

// 성장 곡선: 몬스터가 장비보다 조금 더 빨리 강해짐 → 높은 등급 · 강화 · 제작이 필요
export const power = (lvl) => Math.pow(1.12, Math.max(1, lvl) - 1);
export const MON_GROWTH = 1.145;
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
// 전투 방식은 무기로 결정: 근접(공격+힘) · 원거리(원거리) · 마법(마법)
export const STYLES = {
  melee: { name: '근접', icon: '⚔️', desc: '최대 피해 = (공격 + 힘) x 0.85 - 몬스터 방어 x 0.3' },
  ranged: { name: '원거리', icon: '🏹', desc: '최대 피해 = 원거리 x 0.85 - 몬스터 방어 x 0.3' },
  magic: { name: '마법', icon: '🔮', desc: '최대 피해 = 마법 x 0.7 - 몬스터 방어 x 0.22 (방어 일부 관통)' },
};
export const STYLE_IDS = Object.keys(STYLES);
export const HERO_BASE = { atk: 5, str: 5, rng: 10, mag: 12, def: 0, hp: 100, crit: 0.05, ls: 0, dr: 0, regen: 0 };
export const STAT_CAPS = { crit: 0.75, ls: 0.2, dr: 0.6, regen: 0.05 };
export const CRIT_MULT = 1.5;
export const BASE_MIN_HIT = 0.15;   // 최소 피해 = 최대 피해의 15% (+무기 보너스)
// 전투 방식별 한 방 최대 피해
export function maxHitFor(style, st, mDef) {
  if (style === 'ranged') return Math.max(1, st.rng * 0.85 - mDef * 0.3);
  if (style === 'magic') return Math.max(1, st.mag * 0.7 - mDef * 0.22);
  return Math.max(1, (st.atk + st.str) * 0.85 - mDef * 0.3);
}
// 받는 피해: 몬스터 힘 x 0.58 x (1 - 방어 효율), 최소 몬스터 힘의 4%
export function incomingHit(mStr, def) {
  const eff = (def * 0.25) / (def * 0.25 + 100 + mStr * 0.2);
  return Math.max(mStr * 0.04, mStr * 0.58 * (1 - eff));
}
export const defEfficiency = (def, mStr) => (def * 0.25) / (def * 0.25 + 100 + mStr * 0.2);

// ---- 지역 ----
export const ZONES = [
  {
    mats: ['mon_feather', 'mon_hide', 'mon_mushroom'],
    name: '고요한 숲', sky: ['#8fd3f4', '#e2f7d4'], hill: '#6fae5a', ground: '#4c8a3a',
    monsters: [['🐛', '애벌레'], ['🐀', '들쥐'], ['🐌', '독달팽이'], ['🦔', '가시고슴도치'], ['🐍', '풀뱀']],
    boss: ['🐗', '멧돼지 우두머리'],
  },
  {
    mats: ['mon_slime', 'mon_venom', 'mon_mushroom'],
    name: '안개 늪', sky: ['#7b8d99', '#c4d1bd'], hill: '#5a7563', ground: '#3d5a46',
    monsters: [['🐸', '늪개구리'], ['🦟', '흡혈모기'], ['🦎', '늪도마뱀'], ['🍄', '걷는 버섯'], ['🐢', '이끼거북']],
    boss: ['🐊', '늪의 군주'],
  },
  {
    mats: ['mon_hide', 'mon_claw', 'mon_web', 'mon_horn'],
    name: '바위 협곡', sky: ['#f6c48a', '#f7e3c3'], hill: '#b07a4f', ground: '#8a5b38',
    monsters: [['🦂', '협곡전갈'], ['🦅', '바위독수리'], ['🐺', '회색늑대'], ['🦬', '성난 들소'], ['🕷️', '동굴거미']],
    boss: ['🦍', '협곡의 폭군'],
  },
  {
    mats: ['mon_ember', 'mon_scale', 'mon_claw'],
    name: '화염 동굴', sky: ['#3a0d0d', '#a8341c'], hill: '#5e1a12', ground: '#2e0f0b',
    monsters: [['🔥', '불도깨비'], ['🦇', '용암박쥐'], ['🦖', '화염 랩터'], ['👺', '화염 요괴'], ['🦀', '용암게']],
    boss: ['🐉', '화염룡'],
  },
  {
    mats: ['mon_ice', 'mon_hide', 'mon_horn'],
    name: '얼음 성채', sky: ['#a9d6ff', '#f0f8ff'], hill: '#c8e2f5', ground: '#9cc3de',
    monsters: [['⛄', '서리 정령'], ['🐧', '빙하 펭귄'], ['🐳', '얼음 고래'], ['🐻', '설원곰'], ['🧊', '얼음 골렘']],
    boss: ['🐘', '고대 매머드'],
  },
  {
    mats: ['mon_ecto', 'mon_shadow', 'mon_cloth'],
    name: '그림자 왕국', sky: ['#1b1530', '#4a3a6b'], hill: '#2d2445', ground: '#1a1428',
    monsters: [['👻', '망령'], ['💀', '해골 병사'], ['🧟', '구울'], ['🦉', '밤부엉이'], ['🧛', '흡혈귀']],
    boss: ['👹', '그림자 군주'],
  },
  {
    mats: ['mon_storm', 'mon_feather', 'mon_honey'],
    name: '천공의 섬', sky: ['#5ec2ff', '#fff6d6'], hill: '#ffffff', ground: '#7fc06b',
    monsters: [['🌪️', '폭풍 정령'], ['🦜', '천둥새'], ['🐝', '거대 벌'], ['🦋', '환영나비'], ['☁️', '구름 골렘']],
    boss: ['🌩️', '폭풍의 화신'],
  },
  {
    mats: ['mon_pearl', 'mon_ink', 'mon_scale'],
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

// 부위별 기본 능력치 (레벨 1 · 일반 기준)
// off: 공격 성향 수치 → 장비 성향(aff)에 따라 근접(공격·힘) / 원거리 / 마법(x1.2)으로 바뀜
// 성장 스탯(공격·힘·원거리·마법·방어·체력)은 레벨과 등급, 특수 스탯(치명타·흡혈·피해 감소·회복)은 등급만 반영
export const SLOTS = {
  weapon: { name: '무기', icon: '🗡️' },
  shield: { name: '방패', icon: '🛡️', noun: '방패', stats: { def: 8, hp: 20, dr: 0.01 } },
  helm: { name: '투구', icon: '⛑️', noun: '투구', stats: { def: 5, hp: 10 } },
  body: { name: '갑옷', icon: '🥋', noun: '갑옷', stats: { def: 12, hp: 30 } },
  legs: { name: '각반', icon: '👖', noun: '각반', stats: { def: 9, hp: 20 } },
  gloves: { name: '장갑', icon: '🧤', nouns: { melee: '건틀릿', ranged: '사수 장갑', magic: '마법사 장갑' }, stats: { off: 3, crit: 0.02 } },
  boots: { name: '장화', icon: '👢', noun: '장화', stats: { def: 3, hp: 10 } },
  amulet: { name: '목걸이', icon: '📿', nouns: { melee: '전사의 목걸이', ranged: '명사수 목걸이', magic: '현자의 목걸이' }, stats: { off: 4, crit: 0.015 } },
  ring1: { name: '반지 1', icon: '💍', nouns: { melee: '힘의 반지', ranged: '매의 반지', magic: '마력의 반지' }, stats: { off: 2, ls: 0.004 } },
  ring2: { name: '반지 2', icon: '💍', nouns: { melee: '힘의 반지', ranged: '매의 반지', magic: '마력의 반지' }, stats: { off: 2, ls: 0.004 } },
  cape: { name: '망토', icon: '🧣', noun: '망토', stats: { def: 4, hp: 15, regen: 0.002 } },
  off: { name: '보조장비', icon: '📘', nouns: { melee: '숫돌', ranged: '화살통', magic: '마도서' }, stats: { off: 3 } },
};
export const SLOT_IDS = Object.keys(SLOTS);
export const AFF_SLOTS = ['gloves', 'amulet', 'ring1', 'ring2', 'off'];
export const DROP_SLOTS = SLOT_IDS.filter((x) => x !== 'ring2'); // 반지는 한 종류로 드롭
export const isRing = (slot) => slot === 'ring1' || slot === 'ring2';

// 무기 종류: 근접 3 · 원거리 2 · 마법 2
export const WEAPONS = {
  sword: { style: 'melee', noun: '한손검', stats: { atk: 10 }, minHit: 0.1, speed: 1.0 },
  blade: { style: 'melee', noun: '장검', stats: { atk: 9, str: 4 }, minHit: 0, speed: 0.95 },
  great: { style: 'melee', noun: '양손검', stats: { atk: 17, str: 8 }, minHit: 0, speed: 0.75, twoHand: true },
  xbow: { style: 'ranged', noun: '석궁', stats: { rng: 15 }, minHit: 0.05, speed: 0.9 },
  bow: { style: 'ranged', noun: '장궁', stats: { rng: 24 }, minHit: 0.03, speed: 1.0, twoHand: true },
  wand: { style: 'magic', noun: '마법봉', stats: { mag: 15, ls: 0.01 }, minHit: 0, speed: 0.9 },
  staff: { style: 'magic', noun: '지팡이', stats: { mag: 27 }, minHit: 0, speed: 0.8, twoHand: true },
};
export const WEAPON_IDS = Object.keys(WEAPONS);

export const STAT_NAMES = {
  atk: '공격', str: '힘', rng: '원거리', mag: '마법', def: '방어', hp: '체력',
  crit: '치명타', ls: '흡혈', dr: '피해 감소', regen: '초당 회복',
};
export const PCT_STATS = ['crit', 'ls', 'dr', 'regen'];
const GROW = ['atk', 'str', 'rng', 'mag', 'def', 'hp', 'off'];
// 영웅(3등급) 이상 장비에 붙는 특수 옵션 (기본값, 등급 배율 적용)
export const SPECIALS = { crit: 0.015, ls: 0.006, dr: 0.015, regen: 0.002 };
export const ENHANCE_MAX = 10;

export function baseStats(it) {
  return it.slot === 'weapon' ? WEAPONS[it.kind || 'sword'].stats : SLOTS[it.slot].stats;
}
export const itemStyle = (it) => (it.slot === 'weapon' ? WEAPONS[it.kind || 'sword'].style : AFF_SLOTS.includes(it.slot) ? it.aff || 'melee' : null);

// 장비 최종 능력치
export function itemStats(it) {
  const out = {};
  const R = RARITIES[it.r].mult;
  const g = R * (1 + 0.1 * (it.enh || 0)) * power(it.lvl);
  const add = (k, v) => { out[k] = (out[k] || 0) + v; };
  for (const [k, v] of Object.entries(baseStats(it))) {
    if (k === 'off') {
      const a = it.aff || 'melee';
      if (a === 'ranged') add('rng', v * g);
      else if (a === 'magic') add('mag', v * g * 1.2);
      else { add('atk', v * g * 0.5); add('str', v * g * 0.5); }
    } else add(k, GROW.includes(k) ? v * g : v * R);
  }
  if (it.sp) for (const [k, v] of Object.entries(it.sp)) add(k, v * R);
  return out;
}

// 전투 방식 기준 공격 수치
export function offenseOf(st, style) {
  if (style === 'ranged') return st.rng || 0;
  if (style === 'magic') return (st.mag || 0) * 0.82;
  return (st.atk || 0) + (st.str || 0);
}
// 비교용 점수. style: 영웅의 전투 방식 (무기는 자기 방식으로 평가)
export function itemScore(it, style = 'melee') {
  if (!it) return 0;
  const st = itemStats(it);
  const p = power(it.lvl);
  const sty = it.slot === 'weapon' ? itemStyle(it) : style;
  return offenseOf(st, sty) + (st.def || 0) * 0.5 + (st.hp || 0) * 0.15
    + ((st.crit || 0) * 30 + (st.ls || 0) * 300 + (st.dr || 0) * 150 + (st.regen || 0) * 1000) * p;
}

export const itemNoun = (it) => {
  if (it.slot === 'weapon') return WEAPONS[it.kind || 'sword'].noun;
  const s = SLOTS[it.slot];
  return s.nouns ? s.nouns[it.aff || 'melee'] : s.noun;
};
export const itemName = (it) => `${materialOf(it.lvl)} ${itemNoun(it)}` + (it.enh > 0 ? ` +${it.enh}` : '');
export const itemSellPrice = (it) => goldPerKill(it.lvl) * 2 * RARITIES[it.r].mult * (1 + (it.enh || 0) * 0.5);
export const enhanceCost = (it) => goldPerKill(it.lvl) * 15 * Math.pow(1.55, it.enh || 0);

export const statVal = (k, v) => (PCT_STATS.includes(k) ? (v * 100).toFixed(k === 'regen' ? 2 : 1) + '%' : fmt(v));
export function statText(st) {
  return Object.entries(st).map(([k, v]) => `${STAT_NAMES[k]} ${statVal(k, v)}`).join(' · ');
}

// ---- 전리품 표 ----
// 몬스터마다 정해진 전리품 목록. 각 항목을 따로 굴리며, 드롭률 효과가 모든 확률에 곱해짐 (최대 100%)
function seeded(n) {
  let a = (n * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
export const BONES = ['bone', 'bone_big', 'bone_beast', 'bone_dragon', 'bone_ancient'];
export const LOOT_POOLS = {
  log: ['log_oak', 'log_birch', 'log_pine', 'log_aspen', 'log_maple', 'log_cedar', 'log_ebony', 'log_yew', 'log_frost', 'log_world'],
  ore: ['ore_copper', 'rune_ess', 'coal', 'ore_iron', 'ore_gold', 'ore_cobalt', 'ore_mithril', 'ore_titan', 'ore_adamant', 'ore_frost', 'ore_aether'],
  fish: ['fish_minnow', 'fish_perch', 'fish_salmon', 'fish_shrimp', 'fish_carp', 'fish_pike', 'fish_tropical', 'fish_eel', 'fish_barracuda', 'fish_puffer', 'fish_seasnake', 'fish_angler', 'fish_octopus', 'fish_shark', 'fish_tuna', 'fish_abyss'],
  gem: ['gem_sapphire', 'gem_emerald', 'gem_ruby', 'gem_diamond'],
};
export const EQUIP_POOL = [
  ...WEAPON_IDS.map((kind) => ({ slot: 'weapon', kind })),
  ...['shield', 'helm', 'body', 'legs', 'boots', 'cape'].map((slot) => ({ slot })),
  ...['gloves', 'amulet', 'ring1', 'off'].flatMap((slot) => STYLE_IDS.map((aff) => ({ slot, aff }))),
];
const EQUIP_C = [0.02, 0.015, 0.012, 0.01, 0.008, 0.006, 0.004];
export const zoneIndex = (stage) => Math.floor((Math.max(1, stage) - 1) / 10);

// kind: 'normal' | 'boss' | 'zoneBoss', mi: 몬스터 번호 (0~4)
const lootCache = new Map();
export function lootTable(stage, mi = 0, kind = 'normal') {
  const z = zoneIndex(stage);
  const key = `${z}/${mi}/${kind}`;
  if (lootCache.has(key)) return lootCache.get(key);
  const zone = ZONES[z % ZONES.length];
  const boss = kind !== 'normal';
  const qm = kind === 'zoneBoss' ? 5 : boss ? 3 : 1;
  const L = [];
  L.push({ mat: BONES[Math.min(BONES.length - 1, Math.floor(z / 2))], c: boss ? 1 : 0.5, q: [qm, qm * 2] });
  const zm = zone.mats;
  L.push({ mat: zm[mi % zm.length], c: boss ? 1 : 0.4, q: [qm, qm * 2] });
  L.push({ mat: zm[(mi + 1) % zm.length], c: boss ? 0.6 : 0.15, q: [qm, qm] });
  const pool = LOOT_POOLS[['log', 'ore', 'fish'][mi % 3]];
  L.push({ mat: pool[Math.min(pool.length - 1, Math.floor((z * pool.length) / 12))], c: boss ? 0.8 : 0.12, q: [qm, qm * 3] });
  L.push({ mat: z >= 4 ? 'herb_rare' : 'herb', c: boss ? 0.5 : 0.05, q: [1, qm] });
  L.push({ mat: LOOT_POOLS.gem[Math.min(3, Math.floor(z / 2))], c: boss ? 0.1 : 0.004, q: [1, 1] });
  const rnd = seeded(z * 131 + mi * 17 + (boss ? 7 : 1));
  const picks = [...EQUIP_POOL];
  for (const c of EQUIP_C) {
    const e = picks.splice(Math.floor(rnd() * picks.length), 1)[0];
    L.push({ ...e, c: boss ? c * 5 : c });
  }
  lootCache.set(key, L);
  return L;
}

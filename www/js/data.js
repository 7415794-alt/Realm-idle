// 게임 밸런스 / 콘텐츠 데이터
import { fmt } from './format.js';

export const GAME_NAME = '에테르 원정기';
export const VERSION = '3.24.1';
// VIP: 원래 유료 등급이지만 모든 플레이어에게 무료로 최고 등급(VIP++) 적용
export const VIP = { name: 'VIP++', mult: 1.75, label: '+75%' };

// ---- 전투 ----
export const BOSS_TIME = 40;        // 지역 보스 제한 시간(초)
export const RESPAWN = 0.35;        // 몬스터 재등장 시간
export const HERO_REVIVE = 4;       // 영웅 부활 시간
export const INV_MAX = Infinity;    // 가방 무제한
export const OFFLINE_CAP = 6 * 3600; // 오프라인 최대 시간(초)

// 성장 곡선: 몬스터가 장비보다 조금 더 빨리 강해짐 → 높은 등급 · 강화 · 제작이 필요
// 숫자가 너무 커지지 않도록 완만하게 (레벨 80 일반 몬스터 체력 약 1천)
export const power = (lvl) => Math.pow(1.02, Math.max(1, lvl) - 1);
// 몬스터 성장률 (레벨마다): 체력은 빠르게(잠재능력 · 특수 옵션으로 커지는 공격력을 따라감),
// 힘(주는 피해)은 느리게(장비 성장과 비슷 → 한 방에 쓰러지지 않게), 방어는 그 중간
export const MON_GROWTH = { hp: 1.05, def: 1.0427, str: 1.037 };
export const monPower = (stage, k = 'hp') => Math.pow(MON_GROWTH[k], Math.max(1, stage) - 1);
// 골드는 예전 계산식의 1/100 (번 골드 · 쓰는 골드 모두)
// 처치당 골드 = 0.02 x 레벨^1.5 (지수 증가 X → 레벨 300에서도 약 104)
// 칸 강화 · 도구 같은 고정 비용이 후반에도 의미 있게 유지됨
export const goldPerKill = (s) => Math.ceil(0.02 * Math.pow(Math.max(1, s), 1.5));

// 몬스터 능력치 (hp: 체력, def: 방어, str: 힘 → 받는 피해)
export function monsterStats(stage, kind = 'normal') {
  const ease = Math.min(1, 0.4 + 0.04 * (stage - 1)); // 초반(Lv 16 미만) 완화
  const m = { hp: 40 * monPower(stage, 'hp') * ease, def: 5 * monPower(stage, 'def'), str: 21 * monPower(stage, 'str') * ease * ease, interval: 2 };
  if (kind === 'zoneBoss') { m.hp *= 5; m.def *= 1.25; m.str *= 1.3; m.interval = 1.8; }
  m.hp = Math.ceil(m.hp); m.def = Math.ceil(m.def); m.str = Math.ceil(m.str);
  return m;
}

// ---- 전투 공식 ----
// 전투 방식은 무기로 결정: 근접(공격+힘) · 원거리(원거리) · 마법(마법)
// 전투 방식은 직접 선택. 모든 장비에 근접 · 원거리 · 마법 수치가 따로 붙어 있고, 고른 방식의 수치만 피해에 쓰임
export const STYLES = {
  // perk: 방식별 장점 (능력치에 더해짐)
  melee: { name: '근접', icon: '⚔️', stat: 'melee', perk: { hp: 0.2, def: 0.15, ls: 0.02 },
    desc: '최대 피해 = 근접 x 0.85 - 몬스터 방어 x 0.3 · 장점: 체력 +20% · 방어 +15% · 흡혈 +2%p (튼튼함)' },
  ranged: { name: '원거리', icon: '🏹', stat: 'rng', perk: { crit: 0.12, cdmg: 0.4, dr: 0.12, spd: 0.1 },
    desc: '최대 피해 = 원거리 x 0.85 - 몬스터 방어 x 0.3 · 장점: 치명타 +12%p · 치명타 피해 +40%p · 공격 속도 +10% · 받는 피해 -12%p (거리 유지)' },
  magic: { name: '마법', icon: '🔮', stat: 'mag', perk: { pen: 0.25, dmg: 0.15, boss: 0.3, regen: 0.01 },
    desc: '최대 피해 = 마법 x 0.8 - 몬스터 방어 x 0.22 · 장점: 방어 무시 +25%p · 모든 피해 +15% · 보스 피해 +30% · 초당 회복 +1%p' },
};
export const STYLE_IDS = Object.keys(STYLES);
export const HERO_BASE = { melee: 10, rng: 10, mag: 10, def: 0, hp: 100, crit: 0.05, ls: 0, dr: 0, regen: 0 };
// 특수 옵션 최대치는 잠재능력 최고 등급(x38)에 맞춰 상향: 모든 수급처를 모으면 최대치의 1.4배 이상
export const STAT_CAPS = { crit: 0.75, ls: 0.25, dr: 0.6, regen: 0.08, pen: 0.9, spd: 3.5, dmg: 15, boss: 13, cdmg: 13, gold: 70, drop: 35, normal: 13, counter: 0.5, double: 0.6, mhit: 0.45, xp: 8 };
export const CRIT_MULT = 1.5;
export const BASE_MIN_HIT = 0.15;   // 최소 피해 = 최대 피해의 15% (+무기 보너스)
// 전투 방식별 한 방 최대 피해
export function maxHitFor(style, st, mDef) {
  if (style === 'ranged') return Math.max(1, st.rng * 0.85 - mDef * 0.3);
  if (style === 'magic') return Math.max(1, st.mag * 0.8 - mDef * 0.22);
  return Math.max(1, st.melee * 0.85 - mDef * 0.3);
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
    monsters: [['🦂', '협곡전갈'], ['🦅', '바위독수리'], ['🐺', '회색늑대'], ['🐃', '성난 들소'], ['🕷️', '동굴거미']],
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

// ---- 지도 ----
// 지역 z(0부터, 8개를 넘으면 더 강해진 채로 반복) · 몬스터 mi(0~4 일반, 5 지역 보스)
// 몬스터 레벨 = z x 10 + [1, 3, 5, 7, 9], 보스 = z x 10 + 10. 지역 보스를 처음 잡으면 다음 지역이 열림
export const BOSS_MI = 5;
export const MON_LV = [1, 3, 5, 7, 9, 10];
export const monLevel = (z, mi) => z * 10 + MON_LV[mi];
export const AUTO_STREAK = 10;  // 자동 진행: 같은 몬스터를 이만큼 연속 처치하면 다음 몬스터로
export const BOSS_RETRY = 30;   // 자동 진행: 보스에게 지면 이만큼 더 사냥한 뒤 재도전
export const BOSS_GOLD = 15;    // 지역 보스 골드 배율
export function zoneTitle(z) {
  const zone = ZONES[z % ZONES.length];
  const cycle = Math.floor(z / ZONES.length);
  return zone.name + (ROMAN[cycle] ?? ` ${cycle + 1}`);
}
export function monsterInfo(z, mi) {
  const zone = ZONES[z % ZONES.length];
  const boss = mi === BOSS_MI;
  const [e, name] = boss ? zone.boss : zone.monsters[mi];
  return { z, mi, e, name, boss, lvl: monLevel(z, mi), drop: zone.drops[mi] };
}

// ---- 몬스터 고유 전리품 (지역마다 일반 5 + 보스 1) · 고기 ----
// [id, 이름, 아이콘]
const ZONE_DROPS = [
  [['u_silk', '비단실', '➰'], ['u_rattail', '쥐꼬리', '〰️'], ['u_shell', '달팽이 껍데기', '🐚'], ['u_quill', '고슴도치 가시', '📌'], ['u_snakeskin', '뱀 허물', '🎗️'], ['u_tusk', '우두머리 엄니', '🌙']],
  [['u_frogskin', '개구리 점액 피부', '💚'], ['u_bloodsac', '피주머니', '🎈'], ['u_tail', '도마뱀 꼬리', '➿'], ['u_spore', '버섯 포자', '🌫️'], ['u_moss', '이끼 등껍질', '🌱'], ['u_croc', '늪 군주의 가죽', '👜']],
  [['u_stinger', '전갈 독침', '📍'], ['u_eaglefeather', '독수리 깃털', '🎐'], ['u_pelt', '늑대 털가죽', '🧶'], ['u_bisonhorn', '들소 뿔', '📯'], ['u_venomgland', '거미 독샘', '⚗️'], ['u_fist', '폭군의 주먹뼈', '👊']],
  [['u_wisp', '도깨비불', '🕯️'], ['u_batwing', '박쥐 날개', '🦇'], ['u_raptorclaw', '랩터 발톱', '🦖'], ['u_mask', '요괴 가면', '👺'], ['u_crabshell', '용암 게딱지', '🦀'], ['u_heart', '화염룡의 심장', '💗']],
  [['u_tear', '정령의 눈물', '💧'], ['u_icefeather', '얼음 깃털', '❄️'], ['u_baleen', '고래 수염', '🎋'], ['u_paw', '곰 발바닥', '🐾'], ['u_core', '골렘 핵', '⚙️'], ['u_ivory', '매머드 상아', '🦷']],
  [['u_chain', '망령의 사슬', '⛓️'], ['u_skull', '해골', '💀'], ['u_nail', '썩은 손톱', '💅'], ['u_owleye', '부엉이 눈', '👁️'], ['u_fang', '흡혈귀 송곳니', '🗡️'], ['u_crown', '그림자 왕관', '👑']],
  [['u_breath', '정령의 숨결', '💨'], ['u_thunder', '천둥 깃털', '⚡'], ['u_jelly', '로열 젤리', '🍯'], ['u_dust', '나비 날개 가루', '✨'], ['u_cloud', '구름 조각', '☁️'], ['u_eye', '폭풍의 눈', '🌀']],
  [['u_tentacle', '문어 촉수', '🐙'], ['u_inksac', '먹물주머니', '🖤'], ['u_sharktooth', '상어 이빨', '🦈'], ['u_puffgland', '복어 독샘', '🐡'], ['u_conch', '거대 소라', '🐚'], ['u_amber', '용연향', '🔮']],
];
const ZONE_MEATS = [
  ['meat_0', '들짐승 고기', '🍖'], ['meat_1', '늪 생물 고기', '🍗'], ['meat_2', '들소 고기', '🥩'], ['meat_3', '랩터 고기', '🍖'],
  ['meat_4', '매머드 고기', '🥩'], ['meat_5', '수상한 고기', '🍖'], ['meat_6', '천둥새 고기', '🍗'], ['meat_7', '심해 생물 살', '🍣'],
];
ZONES.forEach((zone, z) => { zone.drops = ZONE_DROPS[z].map((d) => d[0]); zone.meat = ZONE_MEATS[z][0]; });

// 박물관: 고유 전리품을 기증해 전시 레벨을 올림 (최대 100레벨). 레벨마다 효과가 조금씩 쌓임
// 레벨 L에 필요한 기증 수 = 기본값 x (1 + 0.15 x (L - 1)). 한 지역 6종의 가장 낮은 레벨 = 지역 세트 레벨
export const MUSEUM_MAX = 100;
export const MUSEUM_NEED = { normal: 20, boss: 3 };
const MUSEUM_KEYS = [['atk', 0.003], ['def', 0.005], ['hp', 0.005], ['gold', 0.006], ['drop', 0.004], ['dmg', 0.006]];
// 세트 레벨 1당 효과
export const ZONE_SET_BONUS = [
  { gather: 0.01 }, { prod: 0.01 }, { xp: 0.01 }, { crit: 0.001 }, { hp: 0.01 }, { ls: 0.0005 }, { drop: 0.01 }, { dmg: 0.01 },
];
export const museumLevelNeed = (base, L) => Math.round(base * (1 + 0.15 * (L - 1)));
// 누적 기증 수 → 레벨
export function museumLevelOf(base, count) {
  let L = 0;
  let need = 0;
  while (L < MUSEUM_MAX) {
    need += museumLevelNeed(base, L + 1);
    if (count < need) break;
    L++;
  }
  return L;
}
// 레벨 L까지 필요한 누적 기증 수
export function museumCumNeed(base, L) {
  let n = 0;
  for (let i = 1; i <= L; i++) n += museumLevelNeed(base, i);
  return n;
}
export const MUSEUM = ZONE_DROPS.flatMap((list, z) => list.map(([id], mi) => ({
  id, z, mi, boss: mi === BOSS_MI,
  base: mi === BOSS_MI ? MUSEUM_NEED.boss : MUSEUM_NEED.normal,
  bonus: { [MUSEUM_KEYS[mi][0]]: MUSEUM_KEYS[mi][1] }, // 레벨 1당
})));

// 창고 재료 정의 (life.js MATS에 합쳐짐)
export const LOOT_MATS = {
  ...Object.fromEntries(ZONE_DROPS.flatMap((list, z) => list.map(([id, name, icon], mi) => [id, {
    name, icon, value: mi === BOSS_MI ? 8 + z * 6 : 1 + z, unique: true,
  }]))),
  ...Object.fromEntries(ZONE_MEATS.map(([id, name, icon], z) => [id, { name, icon, value: 0.4 + z * 0.4, meat: true }])),
  chest: { name: '보물 상자', icon: '🎁', value: 30, chest: true },
  cube: { name: '잠재 큐브', icon: '🎲', value: 20, cube: true },
};


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
export const MATERIALS = ['청동', '철', '강철', '은강', '미스릴', '아다만', '룬', '용린', '별철', '에테르', '공허', '태초', '성운', '천공', '영원', '신성', '창조', '무한'];
// 장비 단계: 10레벨마다 한 단계 (재질 이름 하나 = 한 단계, 수치도 단계마다 고정)
export const itemTier = (lvl) => Math.floor((Math.max(1, lvl) - 1) / 10);
export const tierLvl = (lvl) => itemTier(lvl) * 10 + 5;
// 재질 단계 배율: 한 단계 위 재질은 수치 x1.35 (같은 등급이면 확실히 좋고, 등급 약 3단계 차이를 뒤집음)
export const TIER_GROW = 1.35;
export const tierPow = (lvl) => 1.08 * Math.pow(TIER_GROW, itemTier(lvl));
export const materialOf = (lvl) => {
  const t = itemTier(lvl);
  return t < MATERIALS.length ? MATERIALS[t] : `${MATERIALS[MATERIALS.length - 1]} ${t - MATERIALS.length + 2}`;
};

// 부위별 기본 능력치 (레벨 1 · 일반 기준)
// off: 공격 수치 → 장비마다 굴린 비율(w)에 따라 근접 · 원거리 · 마법 세 가지 수치로 각각 붙음
// 성장 스탯(근접 · 원거리 · 마법 · 방어 · 체력)은 레벨과 등급, 특수 스탯(치명타 · 흡혈 · 피해 감소 · 회복)은 등급만 반영
export const SLOTS = {
  weapon: { name: '무기', icon: '🗡️' },
  shield: { name: '방패', icon: '🛡️', noun: '방패', stats: { off: 1, def: 8, hp: 20, dr: 0.01 } },
  helm: { name: '투구', icon: '⛑️', noun: '투구', stats: { off: 1, def: 5, hp: 10, crit: 0.01 } },
  body: { name: '갑옷', icon: '🥋', noun: '갑옷', stats: { off: 1.5, def: 12, hp: 30 } },
  legs: { name: '각반', icon: '👖', noun: '각반', stats: { off: 1, def: 9, hp: 20 } },
  gloves: { name: '장갑', icon: '🧤', nouns: { melee: '건틀릿', ranged: '사수 장갑', magic: '마법사 장갑' }, stats: { off: 3, crit: 0.02 } },
  boots: { name: '장화', icon: '👢', noun: '장화', stats: { off: 1, def: 3, hp: 10, ls: 0.003 } },
  amulet: { name: '목걸이', icon: '📿', nouns: { melee: '전사의 목걸이', ranged: '명사수 목걸이', magic: '현자의 목걸이' }, stats: { off: 4, crit: 0.015, ls: 0.004 } },
  ring1: { name: '반지 1', icon: '💍', nouns: { melee: '힘의 반지', ranged: '매의 반지', magic: '마력의 반지' }, stats: { off: 2, ls: 0.004 } },
  ring2: { name: '반지 2', icon: '💍', nouns: { melee: '힘의 반지', ranged: '매의 반지', magic: '마력의 반지' }, stats: { off: 2, ls: 0.004 } },
  cape: { name: '망토', icon: '🧣', noun: '망토', stats: { off: 1, def: 4, hp: 15, regen: 0.005 } },
  off: { name: '보조장비', icon: '📘', nouns: { melee: '숫돌', ranged: '화살통', magic: '마도서' }, stats: { off: 3 } },
};
export const SLOT_IDS = Object.keys(SLOTS);
export const AFF_SLOTS = ['gloves', 'amulet', 'ring1', 'ring2', 'off'];
export const DROP_SLOTS = SLOT_IDS.filter((x) => x !== 'ring2'); // 반지는 한 종류로 드롭
export const isRing = (slot) => slot === 'ring1' || slot === 'ring2';

// 무기 종류: 근접 3 · 원거리 2 · 마법 2
// style: 이 무기의 주력 방식 (그 방식 수치가 가장 높게 붙음). 속도 · 최소 피해 · 양손은 어떤 방식으로 싸워도 적용
export const WEAPONS = {
  sword: { style: 'melee', noun: '한손검', stats: { off: 12 }, minHit: 0.1, speed: 1.0 },
  blade: { style: 'melee', noun: '장검', stats: { off: 14 }, minHit: 0, speed: 0.95 },
  great: { style: 'melee', noun: '대검', stats: { off: 18 }, minHit: 0, speed: 0.75 },
  xbow: { style: 'ranged', noun: '석궁', stats: { off: 15 }, minHit: 0.05, speed: 0.9 },
  bow: { style: 'ranged', noun: '장궁', stats: { off: 14 }, minHit: 0.03, speed: 1.0 },
  wand: { style: 'magic', noun: '마법봉', stats: { off: 15, ls: 0.01 }, minHit: 0, speed: 0.9 },
  staff: { style: 'magic', noun: '지팡이', stats: { off: 18 }, minHit: 0, speed: 0.8 },
};
export const WEAPON_IDS = Object.keys(WEAPONS);

export const STAT_NAMES = {
  melee: '근접', rng: '원거리', mag: '마법', def: '방어', hp: '체력',
  crit: '치명타', ls: '흡혈', dr: '피해 감소', regen: '초당 회복',
};
export const PCT_STATS = ['crit', 'ls', 'dr', 'regen'];
// 모든 수치는 소수점 올림: 일반 수치는 정수, 퍼센트 수치는 1% 단위 (표시 = 실제 적용값)
export const ceilN = (v) => Math.ceil(v - 1e-9);
export const ceilP = (v) => Math.ceil(v * 100 - 1e-7) / 100;
export const ceilStat = (k, v) => (PCT_STATS.includes(k) ? ceilP(v) : ceilN(v));
const GROW = ['melee', 'rng', 'mag', 'def', 'hp', 'off'];
// 영웅(3등급) 이상 장비에 붙는 특수 옵션 (기본값, 등급 배율 적용)
export const SPECIALS = { crit: 0.025, ls: 0.012, dr: 0.02, regen: 0.004 };
// 장비칸 강화: 최대 99, 비용은 고정 (평생 유지되므로 비쌈)
export const ENHANCE_MAX = 99;
export const ENHANCE_COST = 5000;
export const ENHANCE_GROW = 1.06; // 레벨이 오를수록 증가폭도 커짐 (매 단계 6%씩)

export function baseStats(it) {
  return it.slot === 'weapon' ? WEAPONS[it.kind || 'sword'].stats : SLOTS[it.slot].stats;
}
// 주력 방식 (이름 · 가장 높은 수치)
export const itemStyle = (it) => (it.slot === 'weapon' ? WEAPONS[it.kind || 'sword'].style : it.aff || 'melee');
// 근접 · 원거리 · 마법 비율: 주력 0.75~1.0, 나머지 0.15~0.55
export function rollWeights(primary, rnd = Math.random) {
  const w = {};
  for (const k of STYLE_IDS) w[k] = k === primary ? 0.75 + rnd() * 0.25 : 0.15 + rnd() * 0.4;
  for (const k of STYLE_IDS) w[k] = Math.round(w[k] * 100) / 100;
  return w;
}
const DEFAULT_W = (p) => Object.fromEntries(STYLE_IDS.map((k) => [k, k === p ? 0.9 : 0.3]));
// 비율은 무작위가 아니라 고정 (주력 방식 0.9 · 나머지 0.3)
export const itemWeights = (it) => DEFAULT_W(itemStyle(it));
// 장비 특수 옵션: 부위마다 고정 (희귀 등급부터 · 전리품 공예는 등급과 상관없이)
export const ITEM_SP = { weapon: 'crit', shield: 'dr', helm: 'crit', body: 'dr', legs: 'regen', gloves: 'crit', boots: 'ls', amulet: 'ls', ring1: 'ls', ring2: 'ls', cape: 'regen', off: 'dr' };
export const hasItemSp = (it) => it.r >= 2 || !!it.sp;
// 특수 옵션 수치: 등급 배율 x 재질 단계마다 +10%
export const itemSpValue = (it) => SPECIALS[ITEM_SP[it.slot]] * RARITIES[it.r].mult * (1 + 0.1 * itemTier(it.lvl));

// 장비 최종 능력치
export function itemStats(it) {
  const out = {};
  const R = RARITIES[it.r].mult;
  const g = R * (1 + 0.05 * (it.enh || 0)) * tierPow(it.lvl);
  // 특수 스탯(치명타 · 흡혈 · 피해 감소 · 회복)도 강화 1회마다 +1%씩 (최대 +99 → x1.99)
  const e = 1 + 0.01 * (it.enh || 0);
  const add = (k, v) => { out[k] = (out[k] || 0) + v; };
  for (const [k, v] of Object.entries(baseStats(it))) {
    if (k === 'off') {
      const w = itemWeights(it);
      add('melee', v * g * w.melee);
      add('rng', v * g * w.ranged);
      add('mag', v * g * w.magic);
    } else add(k, GROW.includes(k) ? v * g : v * R * (1 + 0.1 * itemTier(it.lvl)) * e);
  }
  if (hasItemSp(it) && ITEM_SP[it.slot]) add(ITEM_SP[it.slot], itemSpValue(it) * e);
  for (const k of Object.keys(out)) out[k] = ceilStat(k, out[k]);
  return out;
}

// 전투 방식 기준 공격 수치
export function offenseOf(st, style) {
  if (style === 'ranged') return st.rng || 0;
  if (style === 'magic') return (st.mag || 0) * 0.88;
  return st.melee || 0;
}
// 비교용 점수. style: 영웅의 전투 방식 (무기는 자기 방식으로 평가)
export function itemScore(it, style = 'melee') {
  if (!it) return 0;
  const st = itemStats(it);
  const p = tierPow(it.lvl);
  return offenseOf(st, style) + (st.def || 0) * 0.5 + (st.hp || 0) * 0.15
    + ((st.crit || 0) * 30 + (st.ls || 0) * 300 + (st.dr || 0) * 150 + (st.regen || 0) * 1000) * p
    + potScore(it, style);
}

// ---- 잠재능력 (큐브) ----
// 장비 등급과 같은 21단계(일반 → 에테르). 🎲 큐브로 3줄을 다시 굴림: 등급이 오를 수 있고(올라갈수록 확률↓),
// 같은 등급에서 '천장' 횟수만큼 돌리면 다음 등급 확정. 첫 줄은 지금 등급, 둘째 · 셋째 줄은 20% 확률로 지금 등급 · 아니면 한 단계 아래
// 등급별 수치 배율: 한 등급 오를 때마다 x1.2 (일반 x1 → 영웅 x1.7 → 신화 x2.5 → 일식 x5.2 → 성광 x12.8 → 에테르 x38)
export const POT_MULT = (t) => Math.pow(1.2, t);
// 예전 배율 (저장 데이터 변환용)
export const POT_MULT_OLD = (t) => 1 + 0.45 * t;
export const POT_TIERS = RARITIES.map((r, t) => {
  const last = t === RARITIES.length - 1;
  const up = last ? 0 : 0.1 * 0.76 ** t;
  return { name: r.name, color: r.color, mult: POT_MULT(t), up, pity: last ? 0 : Math.ceil(1.5 / up) };
});
// key: 효과 종류(기도 · 펫과 같은 이름), b: 일반 등급 수치(등급 배율을 곱함), w: 나올 가중치
export const POT_LINES = [
  // 수치는 1% 단위로 올림되므로 가장 낮은 등급도 1% 이상 (등급이 오를 때마다 숫자가 눈에 띄게 커짐)
  { key: 'melee', b: 0.02, w: 10 },
  { key: 'rng', b: 0.02, w: 10 },
  { key: 'mag', b: 0.02, w: 10 },
  { key: 'atk', b: 0.015, w: 6 },
  { key: 'def', b: 0.025, w: 8 },
  { key: 'hp', b: 0.025, w: 8 },
  { key: 'crit', b: 0.01, w: 10 },
  { key: 'ls', b: 0.01, w: 8 },
  { key: 'dr', b: 0.01, w: 4 },
  { key: 'regen', b: 0.01, w: 6 },
  // 특수 옵션: 부위마다 1개, 영웅 등급부터 나오고 일반 옵션보다 수치가 훨씬 큼 (같은 옵션이 3줄 모두 나올 수도 있음)
  // 골드 · 드롭률처럼 전투와 상관없는 옵션은 특수 옵션으로만 나옴
  // v3.24: 부위마다 서로 다른 특수 옵션 (13종) · 각 옵션은 한 부위에서만 나오므로 줄당 수치가 큼
  { key: 'dmg', b: 0.085, w: 8, sp: true },
  { key: 'boss', b: 0.1, w: 8, sp: true },
  { key: 'pen', b: 0.04, w: 8, sp: true },
  { key: 'cdmg', b: 0.1, w: 8, sp: true },
  { key: 'spd', b: 0.027, w: 8, sp: true },
  { key: 'gold', b: 0.54, w: 8, sp: true },
  { key: 'drop', b: 0.27, w: 8, sp: true },
  { key: 'normal', b: 0.106, w: 8, sp: true },   // 일반 몬스터 피해
  { key: 'counter', b: 0.004, w: 8, sp: true }, // 피격 시 반격 확률
  { key: 'double', b: 0.005, w: 8, sp: true },  // 연속 공격 확률
  { key: 'mhit', b: 0.0037, w: 8, sp: true },   // 최소 피해 (최대 피해 대비 %p)
  { key: 'xp', b: 0.066, w: 8, sp: true },      // 생활 스킬 경험치
  { key: 'stat', b: 0.03, w: 8, sp: true },     // 모든 능력치 (공격 · 방어 · 체력 %)
];
// 추가 잠재능력: 같은 3줄(펫 5줄)이지만 수치는 잠재능력의 절반 · 같은 큐브를 사용
export const ADD_POT_MULT = 0.5;
export const POT_SP_MIN = 3; // 특수 옵션이 나오기 시작하는 등급 (영웅)
// 부위별 특수 옵션 (부위마다 1개)
export const POT_SPECIAL = {
  weapon: 'dmg',      // 모든 피해
  shield: 'counter',  // 반격
  helm: 'pen',        // 방어 무시
  body: 'normal',     // 일반 몬스터 피해
  legs: 'spd',        // 공격 속도
  gloves: 'cdmg',     // 치명타 피해
  boots: 'double',    // 연속 공격
  amulet: 'gold',     // 골드
  ring1: 'drop',      // 드롭률
  ring2: 'xp',        // 생활 경험치
  cape: 'boss',       // 보스 피해
  off: 'mhit',        // 최소 피해
  pet: 'stat',        // 모든 능력치
};
// 잠금: 잠근 줄 수에 따라 큐브(또는 골드) 소모 배수
export const POT_LOCK_COST = [1, 3, 8, 20, 50];
// 펫: 잠재능력 5줄 · 골드 강화
export const PET_POT_LINES = 5;
export const PET_ENH_MAX = 50;
export const PET_ENH = { atk: 0.015, def: 0.02, hp: 0.02 }; // 강화 1레벨당
export const petEnhCost = (lvl, L) => Math.ceil(goldPerKill(Math.max(1, lvl)) * 35 * Math.pow(1.23, L)); // 평생 유지되므로 예전보다 조금 비쌈
export const potValue = (key, t, add = false) => {
  const l = POT_LINES.find((x) => x.key === key);
  return l ? Math.round(l.b * POT_MULT(t) * (add ? ADD_POT_MULT : 1) * 1e4) / 1e4 : 0;
};
// 이 부위 · 등급에서 나올 수 있는 옵션 (같은 옵션이 여러 줄에 겹쳐 나올 수 있음)
export function potPool(slot, tier) {
  const sp = tier >= POT_SP_MIN ? POT_SPECIAL[slot] : null;
  return POT_LINES.filter((l) => !l.sp || l.key === sp);
}
function potLine(tier, rnd, slot, add) {
  const pool = potPool(slot, tier);
  let x = rnd() * pool.reduce((a, l) => a + l.w, 0);
  let l = pool[0];
  for (const c of pool) { x -= c.w; if (x < 0) { l = c; break; } }
  return [l.key, potValue(l.key, tier, add)];
}
// 등급이 오를 때 기존 줄 수치를 새 등급 기준으로 끌어올림 (첫 줄은 지금 등급, 나머지는 한 단계 아래 이상)
export function liftLine([k, v], i, t, add = false) {
  return [k, Math.max(v, potValue(k, i === 0 ? t : Math.max(0, t - 1), add))];
}
// 지금 등급 t로 3줄 굴림 (등급 상승 판정 포함, force면 천장으로 확정 상승)
// keep: 잠근 줄 [i] = 기존 줄 (그대로 유지)
export function rollPot(t = 0, rnd = Math.random, force = false, slot = '', keep = [], n = 3, add = false) {
  if (t < POT_TIERS.length - 1 && (force || rnd() < POT_TIERS[t].up)) t++;
  const lines = [];
  for (let i = 0; i < n; i++) {
    // 잠근 줄은 옵션 그대로, 등급이 오르면 수치도 새 등급만큼 오름
    if (keep[i]) { lines.push(liftLine(keep[i], i, t, add)); continue; }
    lines.push(potLine(i === 0 || rnd() < 0.2 || t === 0 ? t : t - 1, rnd, slot, add));
  }
  return { t, lines };
}
// 잠재능력 합 (장착 장비)
export function potSum(items) {
  const out = {};
  for (const it of items) if (it?.pot) for (const [k, v] of it.pot.lines) out[k] = (out[k] || 0) + ceilP(v);
  return out;
}
// 비교 점수에 쓰는 잠재능력 가치 (대략적인 전투력 환산)
const POT_VAL = { atk: 1, def: 0.4, hp: 0.4, crit: 1, ls: 3, dr: 3, regen: 5, drop: 0.03, gold: 0.03, dmg: 1.2, boss: 0.4, pen: 0.8, cdmg: 0.4, spd: 1.1, normal: 0.4, counter: 1, double: 1.2, mhit: 1, xp: 0.02, stat: 1.5 };
export function potScore(it, style) {
  if (!it?.pot) return 0;
  const X = 60 * power(it.lvl);
  const mine = STYLES[style]?.stat;
  let s = 0;
  for (const [k, v] of it.pot.lines) s += v * X * (k === mine ? 1 : POT_VAL[k] ?? 0);
  return s;
}
// 큐브 가격(골드로 살 때): 아이템 레벨 기준
export const cubeGoldCost = (lvl) => Math.ceil(goldPerKill(Math.max(1, lvl)) * 60);

export const itemNoun = (it) => {
  if (it.slot === 'weapon') return WEAPONS[it.kind || 'sword'].noun;
  const s = SLOTS[it.slot];
  return s.nouns ? s.nouns[it.aff || 'melee'] : s.noun;
};
export const itemName = (it) => `${materialOf(it.lvl)} ${itemNoun(it)}` + (it.enh > 0 ? ` +${it.enh}` : '');
export const itemSellPrice = (it) => Math.ceil(goldPerKill(it.lvl) * 2 * RARITIES[it.r].mult * (1 + (it.enh || 0) * 0.5));
// 장비칸 강화는 평생 유지되므로 비쌈 (예전보다 조금 비쌈)
export const enhanceCost = (o) => Math.ceil(ENHANCE_COST * ENHANCE_GROW ** ((o && o.enh) || 0));

export const statVal = (k, v) => (PCT_STATS.includes(k) ? Math.ceil(v * 100 - 1e-7) + '%' : fmt(v));
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

// z: 지역 번호, mi: 몬스터 번호 (0~4 일반, 5 보스)
// 몬스터마다 30종 안팎: 고유 전리품 · 같은 지역 전리품 · 고기 · 뼈 · 몬스터 재료 · 광석 · 원목 · 물고기 · 약초 · 룬 · 주괴 · 보석 · 음식 · 보물 상자 · 장비
// 몬스터의 '성향'(원목 · 광석 · 물고기)에 맞는 채집물은 더 자주, 더 많이 나옴
const BARS = ['bar_bronze', 'bar_iron', 'bar_gold', 'bar_cobalt', 'bar_mithril', 'bar_titan', 'bar_adamant', 'bar_frost', 'bar_aether'];
const RUNES = ['rune_air', 'rune_fire', 'rune_earth', 'rune_chaos'];
const lootCache = new Map();
// 지역 단계에 맞는 채집물 n개 (단계 주변 · 낮은 쪽 위주)
function tierPick(pool, z, n, rnd) {
  const top = Math.min(pool.length - 1, Math.floor(((z % ZONES.length) + 1) * pool.length / ZONES.length));
  const out = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.max(0, top - Math.floor(rnd() * Math.min(4, top + 1)));
    if (!out.includes(pool[idx])) out.push(pool[idx]);
  }
  return out;
}
export function lootTable(z, mi = 0) {
  const key = `${z}/${mi}`;
  if (lootCache.has(key)) return lootCache.get(key);
  const zone = ZONES[z % ZONES.length];
  const zi = z % ZONES.length;
  const boss = mi === BOSS_MI;
  const qm = boss ? 5 : 1;
  const bc = (c, b) => (boss ? b : c);
  const rnd = seeded(z * 131 + mi * 17 + 3);
  const L = [];
  const add = (mat, c, q) => { if (!L.some((d) => d.mat === mat)) L.push({ mat, c, q }); };
  // 고유 전리품 + 같은 지역 다른 몬스터의 전리품
  add(zone.drops[mi], bc(0.2, 1), boss ? [1, 2] : [1, 1]);
  for (let j = 0; j < 5; j++) if (j !== mi) add(zone.drops[j], bc(0.012, 0.3), [1, qm]);
  // 고기 · 뼈 · 몬스터 재료
  add(zone.meat, bc(0.15, 1), [qm, qm * 2]);
  add(BONES[Math.min(BONES.length - 1, Math.floor((zi * 5) / 8) + Math.floor(z / ZONES.length))], bc(0.5, 1), [qm, qm * 2]);
  zone.mats.forEach((m, j) => add(m, bc(j === mi % zone.mats.length ? 0.35 : 0.08, 0.8), [qm, qm * 2]));
  // 채집물: 성향 3종(자주) + 나머지 각 1~2종(드물게)
  const theme = ['log', 'ore', 'fish'][mi % 3];
  for (const k of ['log', 'ore', 'fish']) {
    const main = k === theme;
    for (const m of tierPick(LOOT_POOLS[k], z, main ? 3 : 2, rnd)) add(m, bc(main ? 0.1 : 0.025, main ? 0.8 : 0.4), [qm, qm * (main ? 3 : 2)]);
  }
  add('coal', bc(0.04, 0.5), [qm, qm * 2]);
  add('rune_ess', bc(0.05, 0.6), [qm, qm * 3]);
  add('herb', bc(0.06, 0.6), [1, qm * 2]);
  add('herb_rare', bc(zi >= 3 ? 0.03 : 0.008, 0.4), [1, qm]);
  add(RUNES[Math.min(3, Math.floor(zi / 2))], bc(0.03, 0.5), [qm, qm * 3]);
  add(BARS[Math.min(BARS.length - 1, zi + Math.floor(rnd() * 2))], bc(0.015, 0.3), [1, qm]);
  // 보석 · 음식 · 물약 · 보물 상자
  add('gem', bc(0.006, 0.2), [1, 1]);
  add(LOOT_POOLS.gem[Math.min(3, Math.floor(zi / 2))], bc(0.004, 0.1), [1, 1]);
  const fish = tierPick(LOOT_POOLS.fish, z, 1, rnd)[0];
  add('food_' + fish.slice(5), bc(0.02, 0.5), [1, qm]);
  add(['pot_atk', 'pot_def', 'pot_gold', 'pot_drop', 'pot_speed', 'pot_hp', 'pot_hp', 'pot_all'][zi], bc(0.004, 0.15), [1, 1]);
  add('chest', bc(0.002, 0.08), [1, 1]);
  add('cube', bc(0.004, 0.2), [1, qm]);
  // 정해진 장비 7종
  const picks = [...EQUIP_POOL];
  for (const c of EQUIP_C) {
    const e = picks.splice(Math.floor(rnd() * picks.length), 1)[0];
    L.push({ ...e, c: boss ? c * 5 : c });
  }
  lootCache.set(key, L);
  return L;
}

// ---------- 환생 · 프레스티지 ----------
// 환생: 장비 · 장비칸 강화 · 골드 · 생활 스킬 레벨 · 재료 · 단계가 처음으로 돌아가고 프레스티지(✨)를 얻음
// 유지: 박물관 · 생활 스킬 수련 · 잠재능력 / 추가 잠재능력 · 큐브 · 펫 · 퀘스트 · 설정 · 프레스티지 강화
export const REBIRTH_MIN = 100; // 환생 가능한 최소 몬스터 레벨
export const prestigeGain = (maxStage, mult = 1) => (maxStage < REBIRTH_MIN ? 0 : Math.floor(Math.pow(maxStage / 40, 1.8) * mult));
// key: 효과 종류, v: 레벨당 효과, max: 최대 레벨, c: 첫 비용, g: 레벨마다 비용 배수
export const PRESTIGE = [
  // 전투
  { id: 'atk', icon: '⚔️', name: '불멸의 무력', key: 'atk', v: 0.1, max: 500, c: 1, g: 1.12, desc: '모든 공격 스탯' },
  { id: 'hp', icon: '❤️', name: '불멸의 육체', key: 'hp', v: 0.1, max: 500, c: 1, g: 1.12, desc: '최대 체력' },
  { id: 'def', icon: '🛡️', name: '불멸의 갑주', key: 'def', v: 0.1, max: 500, c: 1, g: 1.12, desc: '방어' },
  { id: 'dmg', icon: '💥', name: '영혼의 일격', key: 'dmg', v: 0.05, max: 100, c: 3, g: 1.18, desc: '모든 피해' },
  { id: 'cdmg', icon: '🎯', name: '날카로운 영혼', key: 'cdmg', v: 0.05, max: 100, c: 3, g: 1.18, desc: '치명타 피해' },
  { id: 'spd', icon: '⚡', name: '시간 가속', key: 'spd', v: 0.02, max: 50, c: 5, g: 1.22, desc: '공격 속도' },
  // 재화 · 성장
  { id: 'gold', icon: '💰', name: '황금의 기억', key: 'gold', v: 0.25, max: 100, c: 2, g: 1.15, desc: '골드' },
  { id: 'drop', icon: '📦', name: '행운의 기억', key: 'drop', v: 0.1, max: 100, c: 2, g: 1.15, desc: '드롭률' },
  { id: 'gain', icon: '✨', name: '윤회의 지혜', key: 'pgain', v: 0.1, max: 100, c: 5, g: 1.2, desc: '환생 때 얻는 프레스티지' },
  { id: 'enh', icon: '🔨', name: '대장장이의 혼', key: 'edisc', v: 0.01, max: 60, c: 3, g: 1.15, desc: '장비칸 골드 강화 비용 감소' },
  // 생활
  { id: 'lxp', icon: '📘', name: '장인의 기억', key: 'lxp', v: 0.1, max: 200, c: 1, g: 1.12, desc: '생활 스킬 경험치' },
  { id: 'lspd', icon: '⏱️', name: '숙련된 손', key: 'lspd', v: 0.03, max: 100, c: 2, g: 1.15, desc: '생활 스킬 행동 속도' },
  { id: 'mdisc', icon: '📚', name: '수련의 길', key: 'mdisc', v: 0.01, max: 60, c: 3, g: 1.15, desc: '생활 스킬 수련 비용 감소' },
  // 편의 · 시작 혜택
  { id: 'cube', icon: '🎲', name: '큐브 상자', key: 'scube', v: 25, max: 100, c: 2, g: 1.15, desc: '환생할 때마다 받는 큐브 (개)', flat: true },
  { id: 'zone', icon: '🗺️', name: '지름길', key: 'szone', v: 1, max: 60, c: 4, g: 1.2, desc: '환생 직후 열려 있는 지역 수 (최고 기록 절반까지)', flat: true },
  { id: 'off', icon: '🌙', name: '꿈속 원정', key: 'offh', v: 1, max: 18, c: 5, g: 1.35, desc: '오프라인 최대 시간 (시간)', flat: true },
  { id: 'luck', icon: '🍀', name: '별의 축복', key: 'luck', v: 0.05, max: 60, c: 5, g: 1.2, desc: '장비 등급 운' },
];
export const prestigeCost = (p, L) => Math.ceil(p.c * Math.pow(p.g, L));

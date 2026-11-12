// 모험 시스템: 날씨 · 펫 · 스킬 보스 · 퀘스트 · 박물관 (DOM 없음)
import {
  goldPerKill, RARITIES, DROP_SLOTS, LOOT_POOLS, itemName, MUSEUM, ZONE_SET_BONUS, ZONES,
  MUSEUM_MAX, museumLevelOf, museumLevelNeed, museumCumNeed,
} from './data.js';
import { fmt } from './format.js';
import { lifeLevel, toolInfo, prayerBonus, bankAdd, LIFE, LIFE_SKILLS, MATS } from './life.js';

// ---------- 시간 (로컬 기준, 월요일 0시 주 시작) ----------
const DAY = 86400000;
const EPOCH = new Date(2026, 0, 5).getTime(); // 2026-01-05 월요일
export const dayIndex = (t = Date.now()) => Math.floor((t - EPOCH) / DAY);
export const weekIndex = (t = Date.now()) => Math.floor(dayIndex(t) / 7);
export function msToNextDay(t = Date.now()) { return DAY - ((t - EPOCH) % DAY); }
export function msToNextWeek(t = Date.now()) { return (7 - (((dayIndex(t) % 7) + 7) % 7)) * DAY - ((t - EPOCH) % DAY); }

function seeded(n) {
  let a = (n * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- 효과 이름 ----------
// atk: 공격·힘 %, def: 방어 %, hp: 체력 %, dmg: 모든 피해 %, gold: 골드 %, drop: 장비 드롭률 %,
// gather: 채집 속도 %, prod: 가공 속도 %, xp: 생활 경험치 %, regen: 초당 체력 회복(최대 체력 비율),
// x_<스킬>: 해당 생활 스킬 결과물 2배 확률
export const BONUS_NAMES = {
  atk: '모든 공격 스탯', melee: '근접', rng: '원거리', mag: '마법', def: '방어', hp: '최대 체력', dmg: '모든 피해',
  gold: '골드', drop: '드롭률', gather: '채집 속도', prod: '가공 속도', xp: '생활 경험치',
  regen: '초당 체력 회복', ls: '흡혈', dr: '피해 감소', crit: '치명타',
};
const FLAT = ['regen', 'ls', 'dr', 'crit'];
export function bonusText(b) {
  return Object.entries(b).map(([k, v]) => {
    if (k.startsWith('x_')) return `${LIFE[k.slice(2)].name} 결과물 2배 ${Math.round(v * 100)}%`;
    return `${BONUS_NAMES[k]} +${Math.round(v * 1000) / 10}%${FLAT.includes(k) ? 'p' : ''}`;
  }).join(', ');
}

// ---------- 날씨 · 계절 ----------
// 계절은 1주마다, 날씨는 하루마다 바뀜 (모든 플레이어 동일)
export const SEASONS = [
  { id: 'spring', name: '봄', icon: '🌸', bonus: { gather: 0.05 } },
  { id: 'summer', name: '여름', icon: '🌻', bonus: { drop: 0.1 } },
  { id: 'autumn', name: '가을', icon: '🍂', bonus: { xp: 0.05 } },
  { id: 'winter', name: '겨울', icon: '⛄', bonus: { prod: 0.05 } },
];
export const WEATHERS = {
  sunny: { name: '맑음', icon: '☀️', bonus: { dmg: 0.08, gold: 0.06 } },
  wind: { name: '강풍', icon: '💨', bonus: { dmg: 0.08, gather: 0.06 } },
  rain: { name: '비', icon: '🌧️', bonus: { xp: 0.08, gather: 0.06 } },
  cloudy: { name: '흐림', icon: '☁️', bonus: { def: 0.08, prod: 0.06 } },
  fog: { name: '안개', icon: '🌫️', bonus: { drop: 0.1, def: 0.05 } },
  storm: { name: '뇌우', icon: '⛈️', bonus: { dmg: 0.12, prod: 0.05 } },
  snow: { name: '눈', icon: '❄️', bonus: { def: 0.08, hp: 0.08, prod: 0.06 } },
  heat: { name: '폭염', icon: '🔥', bonus: { dmg: 0.1, drop: 0.1 } },
};
export const seasonAt = (day) => SEASONS[((Math.floor(day / 7) % 4) + 4) % 4];
export function weatherAt(day) {
  const season = seasonAt(day);
  const pool = ['sunny', 'wind', 'rain', 'cloudy', 'fog', 'storm'];
  if (season.id === 'winter') pool.push('snow', 'snow', 'snow');
  if (season.id === 'summer') pool.push('heat', 'heat', 'heat');
  const id = pool[Math.floor(seeded(day + 7919)() * pool.length)];
  return { id, ...WEATHERS[id] };
}
let wCache = { day: null, season: null, weather: null };
export function climate() {
  const d = dayIndex();
  if (wCache.day !== d) wCache = { day: d, season: seasonAt(d), weather: weatherAt(d) };
  return wCache;
}
function climateBonus(key) {
  const c = climate();
  return (c.season.bonus[key] || 0) + (c.weather.bonus[key] || 0);
}

// ---------- 펫 ----------
// 1마리만 데리고 다님. 획득처:
// shop 상점(골드 · 처치한 몬스터 최고 레벨 조건) · boss 지역 보스 · skill 생활 스킬 중 · sboss 스킬 보스 상자 ·
// monster 일반 몬스터 · weather 해당 날씨에 사냥 · season 해당 계절 주간 퀘스트 · quest 원정 퀘스트
const P = (id, name, icon, src, bonus, extra = {}) => ({ id, name, icon, src, bonus, ...extra });
const ZONE_BOSS_PETS = [
  ['goblin', '아기 멧돼지 대장', '🐗', { gold: 0.3 }],
  ['lizard', '아기 늪 군주', '🐊', { gather: 0.15, prod: 0.1 }],
  ['ape', '꼬마 협곡 폭군', '🦍', { melee: 0.15, hp: 0.1 }],
  ['dragon', '아기 화염룡', '🐲', { dmg: 0.15, def: 0.1 }],
  ['mammoth', '아기 매머드', '🐘', { hp: 0.2, dr: 0.04 }],
  ['lich', '꼬마 그림자 군주', '👹', { mag: 0.15, ls: 0.02 }],
  ['tempest', '아기 폭풍 정령', '🌪️', { rng: 0.15, crit: 0.03 }],
  ['whale', '아기 심연 고래', '🐳', { drop: 0.2, gold: 0.15 }],
];
const MONSTER_PETS = [
  ['caterpillar', '꼬마 애벌레', '🐛', { regen: 0.004 }],
  ['mosquito', '꼬마 흡혈모기', '🦟', { ls: 0.015 }],
  ['scorpion', '꼬마 전갈', '🦂', { crit: 0.03 }],
  ['crab', '용암 꼬마게', '🦀', { def: 0.1 }],
  ['seal', '얼음 꼬마고래', '🐬', { hp: 0.1 }],
  ['owl', '밤 부엉이', '🦉', { mag: 0.08 }],
  ['bee', '거대 꿀벌', '🐝', { rng: 0.08 }],
  ['squid', '꼬마 오징어', '🦑', { drop: 0.1 }],
];
const WEATHER_PETS = {
  sunny: ['lion', '햇살 사자', '🦁', { melee: 0.1, gold: 0.05 }],
  wind: ['eagle', '바람 독수리', '🦅', { rng: 0.1, gather: 0.05 }],
  rain: ['snail', '빗방울 달팽이', '🐌', { xp: 0.1, regen: 0.003 }],
  cloudy: ['sheep', '구름 양', '🐑', { def: 0.1, prod: 0.05 }],
  fog: ['ghostcat', '안개 고양이', '🐈', { drop: 0.12, crit: 0.02 }],
  storm: ['leopard', '번개 표범', '🐆', { dmg: 0.1, crit: 0.02 }],
  snow: ['snowhare', '눈토끼', '🐇', { hp: 0.12, dr: 0.03 }],
  heat: ['camel', '사막 낙타', '🐫', { gold: 0.15, regen: 0.003 }],
};
export const PETS = [
  // 상점 16
  P('dog', '강아지', '🐶', 'shop', { atk: 0.08 }, { stage: 10 }),
  P('turtle', '거북이', '🐢', 'shop', { def: 0.12 }, { stage: 15 }),
  P('hamster', '햄스터', '🐹', 'shop', { regen: 0.005 }, { stage: 18 }),
  P('cat', '고양이', '🐱', 'shop', { gold: 0.15 }, { stage: 20 }),
  P('chick', '병아리', '🐤', 'shop', { regen: 0.01 }, { stage: 25 }),
  P('rabbit', '토끼', '🐰', 'shop', { drop: 0.15 }, { stage: 30 }),
  P('panda', '판다', '🐼', 'shop', { hp: 0.15 }, { stage: 32 }),
  P('squirrel', '다람쥐', '🐿️', 'shop', { gather: 0.1 }, { stage: 35 }),
  P('fox', '여우', '🦊', 'shop', { crit: 0.04 }, { stage: 38 }),
  P('duck', '오리', '🦆', 'shop', { prod: 0.1 }, { stage: 40 }),
  P('monkey', '원숭이', '🐵', 'shop', { rng: 0.12 }, { stage: 45 }),
  P('horse', '조랑말', '🐴', 'shop', { xp: 0.1 }, { stage: 50 }),
  P('koala', '코알라', '🐨', 'shop', { dr: 0.05 }, { stage: 55 }),
  P('tiger', '호랑이', '🐯', 'shop', { melee: 0.12 }, { stage: 60 }),
  P('unicorn', '유니콘', '🦄', 'shop', { mag: 0.12 }, { stage: 65 }),
  P('wolf', '늑대', '🐺', 'shop', { ls: 0.025 }, { stage: 70 }),
  // 지역 보스 8 + 변이 8 (변이는 스테이지 80 이후)
  ...ZONE_BOSS_PETS.map(([id, name, icon, bonus], z) => P(id, name, icon, 'boss', bonus, { zone: z })),
  ...ZONE_BOSS_PETS.map(([id, name, icon, bonus], z) => P(id + '_m', '변이 ' + name, icon, 'boss', Object.fromEntries(Object.entries(bonus).map(([k, v]) => [k, Math.round(v * 1.6 * 1000) / 1000])), { zone: z, mutated: true })),
  // 생활 스킬 10 (해당 스킬을 하다 보면 아주 드물게)
  P('woodpecker', '딱따구리', '🐦', 'skill', { x_wood: 0.25 }, { skill: 'wood' }),
  P('hedgehog', '고슴도치', '🦔', 'skill', { x_mine: 0.2 }, { skill: 'mine' }),
  P('penguin', '펭귄', '🐧', 'skill', { x_fish: 0.2 }, { skill: 'fish' }),
  P('piglet', '꼬마 돼지 요리사', '🐷', 'skill', { x_cook: 0.12 }, { skill: 'cook' }),
  P('ox', '대장간 황소', '🐂', 'skill', { x_smith: 0.12 }, { skill: 'smith' }),
  P('spider', '재봉 거미', '🕷️', 'skill', { x_craft: 0.12 }, { skill: 'craft' }),
  P('frog', '약초 개구리', '🐸', 'skill', { x_alch: 0.12 }, { skill: 'alch' }),
  P('bat', '룬 박쥐', '🦇', 'skill', { x_arcane: 0.12 }, { skill: 'arcane' }),
  P('dove', '성소 비둘기', '🕊️', 'skill', { x_divine: 0.15 }, { skill: 'divine' }),
  P('rat', '소매치기 쥐', '🐀', 'skill', { x_thief: 0.15 }, { skill: 'thief' }),
  // 스킬 보스 3
  P('sapling', '꼬마 고목', '🌱', 'sboss', { gather: 0.15, x_wood: 0.1 }),
  P('pebble', '조약돌 거인', '🗿', 'sboss', { def: 0.1, x_mine: 0.1 }),
  P('krakenling', '아기 크라켄', '🐙', 'sboss', { drop: 0.1, x_fish: 0.1 }),
  // 일반 몬스터 8 (지역별)
  ...MONSTER_PETS.map(([id, name, icon, bonus], z) => P(id, name, icon, 'monster', bonus, { zone: z })),
  // 날씨 8
  ...Object.entries(WEATHER_PETS).map(([w, [id, name, icon, bonus]]) => P(id, name, icon, 'weather', bonus, { weather: w })),
  // 계절 4
  P('blossom', '벚꽃 꿀벌', '🌸', 'season', { gather: 0.12, xp: 0.05 }, { season: 'spring' }),
  P('sunflower', '해바라기 게', '🌻', 'season', { drop: 0.12, gold: 0.05 }, { season: 'summer' }),
  P('turkey', '단풍 칠면조', '🦃', 'season', { xp: 0.12, prod: 0.05 }, { season: 'autumn' }),
  P('reindeer', '눈꽃 순록', '🦌', 'season', { hp: 0.12, def: 0.05 }, { season: 'winter' }),
  // 원정 퀘스트
  P('spirit', '에테르 정령', '✨', 'quest', { dmg: 0.15, gold: 0.15, xp: 0.1 }),
];
export const PET = Object.fromEntries(PETS.map((p) => [p.id, p]));
export const PET_SRC = {
  shop: '🛒 상점', boss: '👑 지역 보스 (1%, 변이는 두 바퀴째 지역(Lv 81+) 보스에게서 0.2%)', skill: '⛏️ 생활 스킬 (행동마다 아주 드물게)',
  sboss: '🐉 스킬 보스 상자', monster: '👾 일반 몬스터 (지역별 0.01%)', weather: '🌦️ 해당 날씨에 사냥 (0.005%)',
  season: '🍂 해당 계절 주간 퀘스트 보상 (25%)', quest: '🗺️ 원정 퀘스트',
};
const BOSS_PET_CHANCE = 0.01;
const MUTANT_CHANCE = 0.002;
const MONSTER_PET_CHANCE = 1e-4;
const WEATHER_PET_CHANCE = 5e-5;
const SKILL_PET_CHANCE = 1 / 15000;

export const petCost = (p) => goldPerKill(p.stage) * 1000;
export function hasPet(s, id) { return s.world.pets.owned.includes(id); }
export function activePet(s) { const id = s.world.pets.active; return id && hasPet(s, id) ? PET[id] : null; }

export function givePet(game, id) {
  const s = game.s;
  if (!PET[id] || hasPet(s, id)) return false;
  s.world.pets.owned.push(id);
  if (!s.world.pets.active) s.world.pets.active = id;
  game.dirtyStats();
  game.toast(`새 펫 획득! ${PET[id].icon} ${PET[id].name}`, 'legend');
  return true;
}
export function buyPet(game, id) {
  const s = game.s;
  const p = PET[id];
  if (!p || p.src !== 'shop' || hasPet(s, id) || s.maxStage < p.stage || s.gold < petCost(p)) return false;
  s.gold -= petCost(p);
  return givePet(game, id);
}
export function setPet(game, id) {
  const s = game.s;
  if (id && !hasPet(s, id)) return false;
  const hpRatio = game.rt.heroHp / game.heroMaxHp();
  s.world.pets.active = s.world.pets.active === id ? null : id;
  game.dirtyStats();
  if (game.rt.heroDead <= 0) game.rt.heroHp = hpRatio * game.heroMaxHp();
  return true;
}
// 처치 시 펫 굴림: 지역 보스 · 일반 몬스터 · 날씨 (모두 드롭률 효과 적용)
export function rollKillPets(game, m) {
  const s = game.s;
  const z = m.z % ZONES.length;
  const lm = game.lootMult();
  if (m.zoneBoss) {
    const base = PETS.find((p) => p.src === 'boss' && p.zone === z && !p.mutated);
    if (base && Math.random() < BOSS_PET_CHANCE * lm) givePet(game, base.id);
    if (m.z >= ZONES.length && Math.random() < MUTANT_CHANCE * lm) givePet(game, base.id + '_m');
  } else if (!m.boss) {
    const mp = PETS.find((p) => p.src === 'monster' && p.zone === z);
    if (mp && Math.random() < MONSTER_PET_CHANCE * lm) givePet(game, mp.id);
  }
  const wp = PETS.find((p) => p.src === 'weather' && p.weather === climate().weather.id);
  if (wp && Math.random() < WEATHER_PET_CHANCE * lm) givePet(game, wp.id);
}
// 생활 스킬 행동마다 해당 스킬 펫 (상위 행동일수록 확률 증가)
export function rollSkillPet(game, skillId, act) {
  const p = PETS.find((x) => x.src === 'skill' && x.skill === skillId);
  if (p && !hasPet(game.s, p.id) && Math.random() < SKILL_PET_CHANCE * (1 + act.lvl / 30)) givePet(game, p.id);
}
// 계절 펫: 주간 퀘스트 보상
export function rollSeasonPet(game) {
  const p = PETS.find((x) => x.src === 'season' && x.season === climate().season.id);
  return p && !hasPet(game.s, p.id) && Math.random() < 0.25 && givePet(game, p.id) ? p : null;
}

// ---------- 박물관 ----------
// 고유 전리품을 기증할수록 전시 레벨이 오르고(최대 MUSEUM_MAX), 레벨마다 효과가 쌓임.
// 한 지역 6종의 가장 낮은 레벨 = 세트 레벨 → 세트 효과도 레벨만큼 쌓임
export const MUSEUM_BY = Object.fromEntries(MUSEUM.map((e) => [e.id, e]));
export const museumCount = (s, id) => s.world.museum[id] || 0;
export const museumLevel = (s, e) => museumLevelOf(e.base, museumCount(s, e.id));
export const museumMaxed = (s, e) => museumLevel(s, e) >= MUSEUM_MAX;
// 다음 레벨까지 { 지금 레벨 안에서 채운 수, 필요 수 }
export function museumNext(s, e) {
  const L = museumLevel(s, e);
  if (L >= MUSEUM_MAX) return null;
  return { have: museumCount(s, e.id) - museumCumNeed(e.base, L), need: museumLevelNeed(e.base, L + 1) };
}
export const zoneSetLevel = (s, z) => Math.min(...MUSEUM.filter((e) => e.z === z).map((e) => museumLevel(s, e)));
const scale = (b, n) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v * n]));
// 효과 합 (기증할 때만 다시 계산)
let mCache = null;
let mCacheS = null;
function museumBonus(s, key) {
  if (mCacheS !== s || !mCache) {
    mCache = {};
    mCacheS = s;
    const add = (b) => { for (const [k, v] of Object.entries(b)) mCache[k] = (mCache[k] || 0) + v; };
    for (const e of MUSEUM) { const L = museumLevel(s, e); if (L) add(scale(e.bonus, L)); }
    ZONE_SET_BONUS.forEach((b, z) => { const L = zoneSetLevel(s, z); if (L) add(scale(b, L)); });
  }
  return mCache[key] || 0;
}
export function museumTotals(s) { museumBonus(s, 'x'); return { ...mCache }; }
export const museumScale = scale;
// mode: 'next' 다음 레벨까지만 · 'all' 보유분 전부(최대 레벨까지)
export function donate(game, id, mode = 'all') {
  const s = game.s;
  const e = MUSEUM_BY[id];
  if (!e) return 0;
  const L = museumLevel(s, e);
  if (L >= MUSEUM_MAX) return 0;
  const cap = mode === 'next' ? museumCumNeed(e.base, L + 1) : museumCumNeed(e.base, MUSEUM_MAX);
  const n = Math.min(s.life.bank[id] || 0, cap - museumCount(s, id));
  if (n <= 0) return 0;
  const setBefore = zoneSetLevel(s, e.z);
  bankAdd(s, id, -n);
  s.world.museum[id] = museumCount(s, id) + n;
  mCache = null;
  game.dirtyStats();
  const L2 = museumLevel(s, e);
  if (L2 > L) game.toast(`🏛️ ${MATS[id].icon} ${MATS[id].name} 전시 Lv ${L2} · ${bonusText(scale(e.bonus, L2))}`, L2 % 10 === 0 ? 'legend' : 'epic');
  const setAfter = zoneSetLevel(s, e.z);
  if (setAfter > setBefore) game.toast(`🏆 ${ZONES[e.z].name} 세트 Lv ${setAfter}! ${bonusText(scale(ZONE_SET_BONUS[e.z], setAfter))}`, 'legend');
  return n;
}
// 전시 레벨 총합
export const museumProgress = (s) => MUSEUM.reduce((n, e) => n + museumLevel(s, e), 0);

// 펫 + 날씨 + 계절 + 박물관 효과 합
export function worldBonus(s, key) {
  return (activePet(s)?.bonus[key] || 0) + climateBonus(key) + museumBonus(s, key);
}

// ---------- 스킬 보스 ----------
// 주간 보스. 주마다 도전 5회, 피해량은 스킬 레벨과 도구 성능으로 결정.
// 누적 피해가 단계(마일스톤)를 넘을 때마다 보상 상자
export const SB = { hp: 5e6, tries: 5, unlockStage: 10, unlockLv: 5, milestones: [0.02, 0.06, 0.15, 0.3, 0.6, 1] };
export const CHEST_NAMES = ['나무 상자', '구리 상자', '은 상자', '금 상자', '보석 상자', '전설 상자'];
export const SKILL_BOSSES = [
  { id: 'treant', name: '고목 수호자', icon: '🌳', skill: 'wood', pet: 'woodpecker', desc: '천 년 묵은 나무. 도끼질로만 쓰러뜨릴 수 있습니다.',
    mats: LOOT_POOLS.log, extra: ['herb', 'herb_rare', 'mon_feather'], bossPet: 'sapling' },
  { id: 'golem', name: '바위 거인', icon: '🗿', skill: 'mine', pet: 'hedgehog', desc: '광맥이 뭉쳐 깨어난 거인. 곡괭이로 부숴야 합니다.',
    mats: LOOT_POOLS.ore, extra: ['gem', 'rune_ess', 'gem_sapphire', 'gem_emerald'], bossPet: 'pebble' },
  { id: 'leviathan', name: '심해 군주', icon: '🦑', skill: 'fish', pet: 'penguin', desc: '깊은 바다의 주인. 낚싯줄로 끌어올려야 합니다.',
    mats: LOOT_POOLS.fish, extra: ['gem', 'herb_rare', 'mon_pearl', 'mon_ink'], bossPet: 'krakenling' },
];
export const SBOSS = Object.fromEntries(SKILL_BOSSES.map((b) => [b.id, b]));

export function sbState(s, id) {
  const w = s.world;
  if (!w.sb[id]) w.sb[id] = { dmg: 0, tries: 0, got: 0 };
  return w.sb[id];
}
export function sbUnlocked(s, b) { return s.maxStage >= SB.unlockStage && lifeLevel(s, b.skill) >= SB.unlockLv; }
// 1회 도전 평균 피해
export function sbDamage(s, b) {
  const lv = lifeLevel(s, b.skill);
  const speed = toolInfo(s, b.skill).cur.speed * (1 + prayerBonus(s, 'gather') + worldBonus(s, 'gather'));
  return Math.pow(lv, 1.5) * 400 * speed;
}
export function sbCheck(s, b) {
  if (s.maxStage < SB.unlockStage) return { ok: false, why: `Lv ${SB.unlockStage} 몬스터 처치 필요` };
  if (lifeLevel(s, b.skill) < SB.unlockLv) return { ok: false, why: `${LIFE[b.skill].name} Lv ${SB.unlockLv}` };
  const st = sbState(s, b.id);
  if (st.dmg >= SB.hp) return { ok: false, why: '이번 주 처치 완료' };
  if (st.tries >= SB.tries) return { ok: false, why: '다음 주에 다시' };
  return { ok: true };
}

function rnd(a, b) { return a + Math.random() * (b - a); }

// 보상 상자 열기 → 설명 줄 목록
function openChest(game, b, i) {
  const s = game.s;
  const lines = [];
  const gold = goldPerKill(Math.max(1, s.maxStage)) * 40 * Math.pow(i + 1, 1.6);
  game.addGold(gold);
  lines.push(`💰 ${fmt(gold)}`);
  const lv = lifeLevel(s, b.skill);
  const top = Math.min(b.mats.length - 1, Math.floor((lv * b.mats.length) / 95));
  const q = Math.round((10 + lv) * (i + 1) * rnd(0.8, 1.2));
  const addM = (id, n) => { if (n > 0) { bankAdd(s, id, n); lines.push(`${MATS[id].icon} ${MATS[id].name} x${fmt(n)}`); } };
  addM(b.mats[top], q);
  if (top > 0) addM(b.mats[top - 1], Math.round(q * 0.6));
  addM(b.extra[Math.floor(Math.random() * b.extra.length)], Math.round((i + 1) * rnd(2, 4)));
  // 장비: 상자 단계만큼 등급 하한
  const item = game.craftItem(DROP_SLOTS, Math.min(i, 5), false);
  lines.push(`<span style="color:${RARITIES[item.r].color}">[${RARITIES[item.r].name}] ${itemName(item)}</span>`);
  // 펫
  // 펫: 보스 전용 펫(마지막 상자일수록 높음) + 해당 스킬 펫
  const petChance = [0.01, 0.01, 0.02, 0.04, 0.08, 0.25][i];
  if (!hasPet(s, b.bossPet) && Math.random() < petChance) { givePet(game, b.bossPet); lines.push(`🐾 펫 ${PET[b.bossPet].icon} ${PET[b.bossPet].name}!`); }
  if (!hasPet(s, b.pet) && Math.random() < petChance / 2) { givePet(game, b.pet); lines.push(`🐾 펫 ${PET[b.pet].icon} ${PET[b.pet].name}!`); }
  return lines;
}

export function attackSkillBoss(game, id) {
  const s = game.s;
  const b = SBOSS[id];
  if (!b || !sbCheck(s, b).ok) return null;
  const st = sbState(s, id);
  const dmg = Math.min(SB.hp - st.dmg, sbDamage(s, b) * rnd(0.85, 1.15));
  st.dmg += dmg;
  st.tries++;
  questEvent(s, 'sb', 1);
  questEvent(s, 'sbdmg', dmg);
  const chests = [];
  while (st.got < SB.milestones.length && st.dmg >= SB.hp * SB.milestones[st.got] - 1e-6) {
    chests.push({ name: CHEST_NAMES[st.got], lines: openChest(game, b, st.got) });
    st.got++;
  }
  return { dmg, chests, killed: st.dmg >= SB.hp };
}

// ---------- 퀘스트 ----------
// 일일 3개 · 주간 2개 (무작위), 원정 퀘스트(순서대로 진행되는 이야기)
const lifeIds = () => LIFE_SKILLS.map((k) => k.id);
const QUEST_TYPES = {
  kill: { icon: '⚔️', text: (n) => `몬스터 ${fmt(n)}마리 처치`, daily: 150 },
  boss: { icon: '👑', text: (n) => `지역 보스 ${fmt(n)}회 처치`, daily: 3 },
  life: { icon: '⛏️', text: (n, key) => `${LIFE[key].icon} ${LIFE[key].name} ${fmt(n)}회`, daily: 60 },
  gold: { icon: '💰', text: (n) => `골드 ${fmt(n)} 획득`, daily: 0 },
  tap: { icon: '👆', text: (n) => `전투 화면 ${fmt(n)}번 탭`, daily: 100 },
  craft: { icon: '🔨', text: (n) => `장비 ${fmt(n)}개 제작`, daily: 3 },
  item: { icon: '🎒', text: (n) => `장비 ${fmt(n)}개 획득`, daily: 15 },
  sb: { icon: '🐉', text: (n) => `스킬 보스 ${fmt(n)}회 도전`, daily: 0 },
};

function makeQuest(s, type, mult) {
  const q = { type, n: 0, claimed: false };
  if (type === 'gold') q.goal = Math.round(goldPerKill(Math.max(1, s.maxStage)) * 400 * mult);
  else if (type === 'sb') q.goal = 6;
  else q.goal = Math.round(QUEST_TYPES[type].daily * mult);
  if (type === 'life') {
    // 레벨이 있는 스킬 위주 (없으면 채집)
    const pool = lifeIds().filter((id) => (s.life.xp[id] || 0) > 0);
    const list = pool.length >= 2 ? pool : ['wood', 'mine', 'fish'];
    q.key = list[Math.floor(Math.random() * list.length)];
  }
  return q;
}
function pick(arr, n) {
  const a = [...arr];
  const out = [];
  while (out.length < n && a.length) out.push(a.splice(Math.floor(Math.random() * a.length), 1)[0]);
  return out;
}
function genDaily(s) { return pick(['kill', 'boss', 'life', 'gold', 'tap', 'craft', 'item'], 3).map((t) => makeQuest(s, t, 1)); }
function genWeekly(s) {
  const types = ['kill', 'boss', 'life', 'gold', 'item'];
  if (s.maxStage >= SB.unlockStage) types.push('sb', 'sb');
  return pick(types, 2).map((t) => makeQuest(s, t, 7));
}

export function questText(q) { return QUEST_TYPES[q.type].text(q.goal, q.key); }
export function questIcon(q) { return QUEST_TYPES[q.type].icon; }
export const questReward = (s, weekly) => ({
  gold: goldPerKill(Math.max(1, s.maxStage)) * (weekly ? 1500 : 150),
  floor: weekly ? 4 : 2,
});

// 원정 퀘스트: 순서대로. reach 계열은 현재 상태로 판정, 나머지는 시작 후 누적
export const CHAIN = [
  { type: 'zone', goal: 1, text: '지도 지역 2곳 개방', reward: { floor: 2 } },
  { type: 'kill', goal: 500, text: '몬스터 500마리 처치', reward: { floor: 3 } },
  { type: 'lifeTotal', goal: 50, text: '총 생활 레벨 50 달성', reward: { floor: 3 } },
  { type: 'zone', goal: 3, text: '지도 지역 4곳 개방', reward: { floor: 4 } },
  { type: 'zoneBoss', goal: 5, text: '지역 보스 5회 처치', reward: { floor: 5 } },
  { type: 'sbdmg', goal: 1e6, text: '스킬 보스에게 피해 1M 누적', reward: { floor: 5 } },
  { type: 'zone', goal: 6, text: '지도 지역 7곳 개방', reward: { floor: 6 } },
  { type: 'lifeTotal', goal: 300, text: '총 생활 레벨 300 달성', reward: { floor: 6 } },
  { type: 'zone', goal: 10, text: '지도 지역 11곳 개방', reward: { floor: 7, pet: 'spirit' } },
];
export function chainProgress(s) {
  const c = CHAIN[s.world.quests.chain];
  if (!c) return null;
  let n = s.world.quests.chainN;
  if (c.type === 'zone') n = s.maxZone;
  else if (c.type === 'lifeTotal') n = lifeIds().reduce((a, id) => a + lifeLevel(s, id), 0);
  return { ...c, n: Math.min(n, c.goal), done: n >= c.goal };
}

export function questEvent(s, type, n = 1, key = null) {
  const Q = s.world.quests;
  for (const q of [...Q.daily, ...Q.weekly]) {
    if (q.type === type && !q.claimed && (!q.key || q.key === key)) q.n = Math.min(q.goal, q.n + n);
  }
  const c = CHAIN[Q.chain];
  if (c && c.type === type) Q.chainN = Math.min(c.goal, Q.chainN + n);
}

// 주기 갱신 (날짜가 바뀌면 일일/주간 퀘스트와 스킬 보스 초기화)
export function worldTick(game) {
  const s = game.s;
  const Q = s.world.quests;
  const d = dayIndex();
  const w = weekIndex();
  if (Q.day !== d) {
    Q.day = d;
    Q.daily = genDaily(s);
  }
  if (Q.week !== w) {
    Q.week = w;
    Q.weekly = genWeekly(s);
  }
  if (s.world.sbWeek !== w) {
    s.world.sbWeek = w;
    s.world.sb = {};
  }
}

export function questClaimable(s) {
  const Q = s.world.quests;
  return [...Q.daily, ...Q.weekly].some((q) => !q.claimed && q.n >= q.goal) || !!chainProgress(s)?.done;
}

function giveReward(game, r) {
  const lines = [];
  if (r.gold) { game.addGold(r.gold); lines.push(`💰 ${fmt(r.gold)}`); }
  if (r.floor !== undefined) {
    const item = game.craftItem(DROP_SLOTS, r.floor, false);
    lines.push(`[${RARITIES[item.r].name}] ${itemName(item)}`);
  }
  if (r.pet && givePet(game, r.pet)) lines.push(`🐾 ${PET[r.pet].name}`);
  return lines;
}
export function claimQuest(game, weekly, idx) {
  const s = game.s;
  const q = (weekly ? s.world.quests.weekly : s.world.quests.daily)[idx];
  if (!q || q.claimed || q.n < q.goal) return null;
  q.claimed = true;
  const lines = giveReward(game, questReward(s, weekly));
  if (weekly) { const sp = rollSeasonPet(game); if (sp) lines.push(`🐾 계절 펫 ${sp.icon} ${sp.name}!`); }
  return lines;
}
export function claimChain(game) {
  const s = game.s;
  const c = chainProgress(s);
  if (!c || !c.done) return null;
  s.world.quests.chain++;
  s.world.quests.chainN = 0;
  return giveReward(game, { gold: goldPerKill(Math.max(1, s.maxStage)) * 500, ...c.reward });
}

export function newWorldState() {
  return {
    pets: { owned: [], active: null },
    sb: {},
    sbWeek: null,
    quests: { day: null, week: null, daily: [], weekly: [], chain: 0, chainN: 0 },
    museum: {},
  };
}

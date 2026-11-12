// 모험 시스템: 날씨 · 펫 · 스킬 보스 · 퀘스트 (DOM 없음)
import { goldPerKill, RARITIES, SLOT_IDS, itemName } from './data.js';
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
  atk: '공격·힘', def: '방어', hp: '최대 체력', dmg: '모든 피해', gold: '골드', drop: '장비 드롭',
  gather: '채집 속도', prod: '가공 속도', xp: '생활 경험치', regen: '초당 체력 회복',
};
export function bonusText(b) {
  return Object.entries(b).map(([k, v]) => {
    if (k.startsWith('x_')) return `${LIFE[k.slice(2)].name} 결과물 2배 ${Math.round(v * 100)}%`;
    return `${BONUS_NAMES[k]} +${Math.round(v * 1000) / 10}%`;
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
// 1마리만 데리고 다님. shop: 골드로 구매(최고 스테이지 조건), boss: 지역 보스 처치 시 드물게,
// skillboss: 스킬 보스 보상 상자, quest: 원정 퀘스트 보상
export const PETS = [
  { id: 'dog', name: '강아지', icon: '🐶', src: 'shop', stage: 10, bonus: { atk: 0.08 } },
  { id: 'turtle', name: '거북이', icon: '🐢', src: 'shop', stage: 15, bonus: { def: 0.12 } },
  { id: 'cat', name: '고양이', icon: '🐱', src: 'shop', stage: 20, bonus: { gold: 0.15 } },
  { id: 'chick', name: '병아리', icon: '🐤', src: 'shop', stage: 25, bonus: { regen: 0.01 } },
  { id: 'rabbit', name: '토끼', icon: '🐰', src: 'shop', stage: 30, bonus: { drop: 0.15 } },
  { id: 'squirrel', name: '다람쥐', icon: '🐿️', src: 'shop', stage: 35, bonus: { gather: 0.1 } },
  { id: 'duck', name: '오리', icon: '🦆', src: 'shop', stage: 40, bonus: { prod: 0.1 } },
  { id: 'horse', name: '조랑말', icon: '🐴', src: 'shop', stage: 50, bonus: { xp: 0.1 } },
  { id: 'goblin', name: '꼬마 고블린 왕', icon: '👺', src: 'boss', bonus: { gold: 0.35 } },
  { id: 'lizard', name: '이끼 도마뱀', icon: '🦎', src: 'boss', bonus: { gather: 0.15, prod: 0.1 } },
  { id: 'lich', name: '꼬마 리치', icon: '💀', src: 'boss', bonus: { atk: 0.15 } },
  { id: 'dragon', name: '아기 용', icon: '🐲', src: 'boss', bonus: { dmg: 0.2, def: 0.1 } },
  { id: 'woodpecker', name: '딱따구리', icon: '🐦', src: 'skillboss', bonus: { x_wood: 0.25 } },
  { id: 'hedgehog', name: '고슴도치', icon: '🦔', src: 'skillboss', bonus: { x_mine: 0.2 } },
  { id: 'penguin', name: '펭귄', icon: '🐧', src: 'skillboss', bonus: { x_fish: 0.2 } },
  { id: 'piglet', name: '꼬마 돼지 요리사', icon: '🐷', src: 'skillboss', bonus: { x_cook: 0.12 } },
  { id: 'ox', name: '대장간 황소', icon: '🐂', src: 'skillboss', bonus: { x_smith: 0.12 } },
  { id: 'spider', name: '재봉 거미', icon: '🕷️', src: 'skillboss', bonus: { x_craft: 0.12 } },
  { id: 'frog', name: '약초 개구리', icon: '🐸', src: 'skillboss', bonus: { x_alch: 0.12 } },
  { id: 'bat', name: '룬 박쥐', icon: '🦇', src: 'skillboss', bonus: { x_arcane: 0.12 } },
  { id: 'dove', name: '성소 비둘기', icon: '🕊️', src: 'skillboss', bonus: { x_divine: 0.15 } },
  { id: 'rat', name: '소매치기 쥐', icon: '🐀', src: 'skillboss', bonus: { x_thief: 0.15 } },
  { id: 'spirit', name: '에테르 정령', icon: '✨', src: 'quest', bonus: { dmg: 0.15, gold: 0.15, xp: 0.1 } },
];
export const PET = Object.fromEntries(PETS.map((p) => [p.id, p]));
export const PET_SRC = { shop: '상점', boss: '지역 보스 (1%)', skillboss: '스킬 보스 보상', quest: '원정 퀘스트' };
const BOSS_PET_CHANCE = 0.01;
const PROD_PETS = ['piglet', 'ox', 'spider', 'frog', 'bat', 'dove', 'rat'];

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
// 지역 보스 처치 시 아직 없는 보스 펫 중 하나
export function rollBossPet(game) {
  if (Math.random() >= BOSS_PET_CHANCE) return;
  const pool = PETS.filter((p) => p.src === 'boss' && !hasPet(game.s, p.id));
  if (pool.length) givePet(game, pool[Math.floor(Math.random() * pool.length)].id);
}

// 펫 + 날씨 + 계절 효과 합
export function worldBonus(s, key) {
  return (activePet(s)?.bonus[key] || 0) + climateBonus(key);
}

// ---------- 스킬 보스 ----------
// 주간 보스. 주마다 도전 5회, 피해량은 스킬 레벨과 도구 성능으로 결정.
// 누적 피해가 단계(마일스톤)를 넘을 때마다 보상 상자
export const SB = { hp: 5e6, tries: 5, unlockStage: 10, unlockLv: 5, milestones: [0.02, 0.06, 0.15, 0.3, 0.6, 1] };
export const CHEST_NAMES = ['나무 상자', '구리 상자', '은 상자', '금 상자', '보석 상자', '전설 상자'];
export const SKILL_BOSSES = [
  { id: 'treant', name: '고목 수호자', icon: '🌳', skill: 'wood', pet: 'woodpecker', desc: '천 년 묵은 나무. 도끼질로만 쓰러뜨릴 수 있습니다.',
    mats: ['log_oak', 'log_pine', 'log_maple', 'log_yew', 'log_world'], extra: ['herb', 'herb_rare'] },
  { id: 'golem', name: '바위 거인', icon: '🗿', skill: 'mine', pet: 'hedgehog', desc: '광맥이 뭉쳐 깨어난 거인. 곡괭이로 부숴야 합니다.',
    mats: ['ore_copper', 'coal', 'ore_iron', 'ore_mithril', 'ore_adamant'], extra: ['gem', 'rune_ess'] },
  { id: 'leviathan', name: '심해 군주', icon: '🦑', skill: 'fish', pet: 'penguin', desc: '깊은 바다의 주인. 낚싯줄로 끌어올려야 합니다.',
    mats: ['fish_minnow', 'fish_shrimp', 'fish_tropical', 'fish_puffer', 'fish_shark'], extra: ['gem', 'herb_rare'] },
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
  if (s.maxStage < SB.unlockStage) return { ok: false, why: `스테이지 ${SB.unlockStage} 필요` };
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
  const top = Math.min(b.mats.length - 1, Math.floor(lv / 15));
  const q = Math.round((10 + lv) * (i + 1) * rnd(0.8, 1.2));
  const addM = (id, n) => { if (n > 0) { bankAdd(s, id, n); lines.push(`${MATS[id].icon} ${MATS[id].name} x${fmt(n)}`); } };
  addM(b.mats[top], q);
  if (top > 0) addM(b.mats[top - 1], Math.round(q * 0.6));
  addM(b.extra[Math.floor(Math.random() * b.extra.length)], Math.round((i + 1) * rnd(2, 4)));
  // 장비: 상자 단계만큼 등급 하한
  const item = game.craftItem(SLOT_IDS, Math.min(i, 5), false);
  lines.push(`<span style="color:${RARITIES[item.r].color}">[${RARITIES[item.r].name}] ${itemName(item)}</span>`);
  // 펫
  const petChance = [0.01, 0.01, 0.02, 0.04, 0.08, 0.25][i];
  if (!hasPet(s, b.pet) && Math.random() < petChance) { givePet(game, b.pet); lines.push(`🐾 펫 ${PET[b.pet].icon} ${PET[b.pet].name}!`); }
  const prodPool = PROD_PETS.filter((id) => !hasPet(s, id));
  if (prodPool.length && Math.random() < 0.02 * (i + 1)) {
    const id = prodPool[Math.floor(Math.random() * prodPool.length)];
    givePet(game, id);
    lines.push(`🐾 펫 ${PET[id].icon} ${PET[id].name}!`);
  }
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
  boss: { icon: '👑', text: (n) => `보스 ${fmt(n)}회 처치`, daily: 5 },
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
  { type: 'stage', goal: 10, text: '스테이지 10 도달', reward: { floor: 2 } },
  { type: 'kill', goal: 500, text: '몬스터 500마리 처치', reward: { floor: 3 } },
  { type: 'lifeTotal', goal: 50, text: '총 생활 레벨 50 달성', reward: { floor: 3 } },
  { type: 'stage', goal: 30, text: '스테이지 30 도달', reward: { floor: 4 } },
  { type: 'zoneBoss', goal: 5, text: '지역 보스 5회 처치', reward: { floor: 5 } },
  { type: 'sbdmg', goal: 1e6, text: '스킬 보스에게 피해 1M 누적', reward: { floor: 5 } },
  { type: 'stage', goal: 60, text: '스테이지 60 도달', reward: { floor: 6 } },
  { type: 'lifeTotal', goal: 300, text: '총 생활 레벨 300 달성', reward: { floor: 6 } },
  { type: 'stage', goal: 100, text: '스테이지 100 도달', reward: { floor: 7, pet: 'spirit' } },
];
export function chainProgress(s) {
  const c = CHAIN[s.world.quests.chain];
  if (!c) return null;
  let n = s.world.quests.chainN;
  if (c.type === 'stage') n = s.maxStage;
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
    const item = game.craftItem(SLOT_IDS, r.floor, false);
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
  return giveReward(game, questReward(s, weekly));
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
  };
}

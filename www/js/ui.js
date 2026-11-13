// DOM UI (탭, 강화 목록, 모달, 토스트)
import {
  STYLE_IDS, POT_TIERS, POT_SPECIAL, POT_SP_MIN, POT_LINES, POT_LOCK_COST, STAT_CAPS, PET_ENH, PET_ENH_MAX, potPool, potValue, SLOTS, SLOT_IDS, ZONES, RARITIES, WEAPONS, BOSS_TIME, BOSS_MI, AUTO_STREAK, MUSEUM, MUSEUM_MAX, ZONE_SET_BONUS,
  monsterInfo, monLevel, zoneTitle, INV_MAX, ENHANCE_MAX, GAME_NAME, VERSION, CRIT_MULT,
  VIP, STYLES, PCT_STATS, ITEM_SP, hasItemSp, itemSpValue, STAT_NAMES, materialOf, zoneOf, itemName, itemStats, itemStyle, itemSellPrice, enhanceCost, goldPerKill, statText, statVal, incomingHit, defEfficiency,
} from './data.js';
import { fmt, fmtPct, fmtTime } from './format.js';
import { exportState, importState, clearState } from './state.js';
import {
  LIFE_SKILLS, LIFE, MATS, BUFFS, LIFE_MAX_LV, LIFE_SPECIAL, lifeSpecialOf, XP_TABLE, lifeLevel, actionTime, burnChance, stealChance,
  hasInputs, matValue, startAction, stopAction, usePotion, sellMat, describeLog, bestFood, foodCount,
  TOOLS, PRAYERS, PRODUCTION, toolInfo, toolUpgradeCheck, upgradeTool, setPrayer, activePrayer, perkText, actionXp, speedMult,
} from './life.js';
import {
  climate, bonusText, BONUS_NAMES, WEATHERS, SEASONS, msToNextDay, msToNextWeek, PETS, PET, PET_SRC, petCost, hasPet, activePet, buyPet, setPet,
  SB, SKILL_BOSSES, CHEST_NAMES, sbState, sbDamage, sbCheck, attackSkillBoss,
  CHAIN, chainProgress, questText, questIcon, questReward, claimQuest, claimChain, questClaimable,
  museumTotals, museumProgress, museumDelta, museumLevel, museumNext, museumScale, zoneSetLevel, donate,
} from './world.js';

const $ = (sel, root = document) => root.querySelector(sel);
const isRingSlot = (slot) => slot === 'ring1' || slot === 'ring2';
// 정확한 숫자 (쉼표 구분, 아주 크면 단위 표기 함께)
const exact = (v) => (!Number.isFinite(v) ? '∞' : Math.abs(v) < 1e15 ? v.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) : fmt(v));
const pct = (v) => (v * 100).toFixed(2).replace(/\.?0+$/, '') + '%';

// 재료 사용처 (생활 스킬 레시피 · 도구 · 박물관)
let USES = null;
function matUses(id) {
  if (!USES) {
    USES = {};
    const add = (x, label) => { (USES[x] ||= new Set()).add(label); };
    for (const k of LIFE_SKILLS) for (const a of k.actions) for (const x of Object.keys(a.in || {})) add(x, k.icon + k.name);
    for (const tl of Object.values(TOOLS)) for (const tier of tl.tiers) for (const x of Object.keys(tier.mats)) add(x, '🛠️도구');
    for (const e of MUSEUM) add(e.id, '🏛️박물관');
  }
  return [...(USES[id] || [])];
}

function h(tag, cls, html) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html !== undefined) el.innerHTML = html;
  return el;
}

function setText(el, v) {
  v = String(v);
  if (el._v !== v) {
    el._v = v;
    el.textContent = v;
  }
}

function setDisabled(el, d) {
  if (el.disabled !== d) el.disabled = d;
}

// 공통 강화 행
function makeRow(icon) {
  const el = h('div', 'row', `
    <div class="ricon">${icon}</div>
    <div class="rinfo">
      <div class="rtitle"><span class="rname"></span><span class="rlv"></span></div>
      <div class="rdesc"></div>
    </div>
    <button class="rbtn"><span class="bt1"></span><span class="bt2"></span></button>`);
  return {
    el,
    name: $('.rname', el), lv: $('.rlv', el), desc: $('.rdesc', el),
    btn: $('.rbtn', el), bt1: $('.bt1', el), bt2: $('.bt2', el),
  };
}

export class UI {
  constructor(game, hooks) {
    this.game = game;
    this.hooks = hooks; // { onReset(state), onImport(state) }
    this.tab = 'hero';
    this.updaters = [];
    this.dom = {
      gold: $('#gold'), power: $('#power'), dps: $('#dps'),
      stageName: $('#stageName'), zoneName: $('#zoneName'),
      progFill: $('#progFill'), progText: $('#progText'), bossBtn: $('#bossBtn'), speedBtn: $('#speedBtn'),
      panel: $('#panel'), skills: $('#skills'), toasts: $('#toasts'),
      modal: $('#modal'), modalBox: $('#modalBox'),
    };
    this.dom.bossBtn.addEventListener('click', () => this.openMap());
    this.dom.speedBtn.addEventListener('click', () => {
      this.game.cycleSpeed();
      this.updateSpeed();
    });
    this.updateSpeed();
    document.querySelectorAll('.tabs button').forEach((b) => {
      b.addEventListener('click', () => this.navTo(() => this.showTab(b.dataset.tab)));
    });
    this.dom.modal.addEventListener('click', (e) => {
      if (e.target === this.dom.modal) this.closeModal();
    });
    this.buildSkills();
    this.showTab('hero');
    this.initNav();
  }

  // ---------- 뒤로가기: 앱이 꺼지지 않고 바로 전 화면으로 ----------
  // 화면을 바꾸거나 창을 열 때마다 기록을 쌓고, 뒤로가기를 누르면 하나씩 되돌림
  // 첫 화면에서는 '한 번 더 누르면 종료' 안내
  initNav() {
    this.navStack = [];
    this.navSkip = 0;
    history.replaceState({ ae: 'root' }, '');
    history.pushState({ ae: 'guard' }, '');
    window.addEventListener('popstate', () => this.onBack());
  }
  pushNav(undo) {
    if (!this.navStack) return;
    if (this.exitArmed) this.rearmGuard();
    this.navStack.push(undo);
    history.pushState({ ae: this.navStack.length }, '');
  }
  // 화면 안 버튼으로 창을 닫았을 때: 쌓아 둔 기록을 조용히 하나 지움
  dropNav() {
    if (!this.navStack?.length) return;
    this.navStack.pop();
    this.navSkip++;
    history.back();
  }
  rearmGuard() {
    clearTimeout(this.exitTimer);
    this.exitArmed = false;
    history.pushState({ ae: 'guard' }, '');
  }
  onBack() {
    if (this.navSkip > 0) { this.navSkip--; return; }
    const undo = this.navStack.pop();
    if (undo) { undo(); return; }
    // 첫 화면: 2초 안에 한 번 더 누르면 종료
    this.exitArmed = true;
    this.toast('뒤로 버튼을 한 번 더 누르면 종료됩니다');
    clearTimeout(this.exitTimer);
    this.exitTimer = setTimeout(() => { if (this.exitArmed && !this.navStack.length) this.rearmGuard(); }, 2000);
  }
  // 화면 상태(탭 · 하위 메뉴 · 스크롤)를 기억해 두고 바꾼 뒤, 뒤로가기로 되돌릴 수 있게 함
  navSnap() {
    return { tab: this.tab, gearView: this.gearView, advView: this.advView, lifeView: this.lifeView, lifeSel: this.lifeSel, dollSel: this.dollSel, scroll: this.dom.panel.scrollTop };
  }
  navTo(fn) {
    const before = this.navSnap();
    fn();
    const after = this.navSnap();
    const same = ['tab', 'gearView', 'advView', 'lifeView', 'lifeSel', 'dollSel'].every((k) => before[k] === after[k]);
    if (same) return;
    this.pushNav(() => {
      Object.assign(this, { gearView: before.gearView, advView: before.advView, lifeView: before.lifeView, lifeSel: before.lifeSel, dollSel: before.dollSel });
      this.showTab(before.tab, true);
      this.dom.panel.scrollTop = before.scroll;
    });
  }

  updateSpeed() {
    const sp = this.game.speed();
    setText(this.dom.speedBtn, (sp > 1 ? '⏩' : '▶') + ' x' + sp);
    this.dom.speedBtn.classList.toggle('fast', sp > 1);
  }

  // ---------- 매 프레임(약 6~7fps) 갱신 ----------
  refresh() {
    const g = this.game;
    const s = g.s;
    const rt = g.rt;
    const d = this.dom;
    setText(d.gold, fmt(s.gold));
    setText(d.power, fmt(g.powerScore()));
    setText(d.dps, fmt(g.totalDps()));
    const tg = s.target;
    const info = monsterInfo(tg.z, tg.mi);
    setText(d.stageName, `${info.e} ${info.name} Lv ${info.lvl}`);
    setText(d.zoneName, zoneTitle(tg.z));

    const m = rt.monster;
    if (m && m.boss && !m.dead) {
      d.progFill.style.width = (Math.max(0, rt.bossTime) / BOSS_TIME) * 100 + '%';
      d.progFill.classList.add('boss');
      setText(d.progText, `보스 제한시간 ${Math.max(0, rt.bossTime).toFixed(1)}초`);
    } else {
      d.progFill.classList.remove('boss');
      if (!s.settings.autoProgress) {
        d.progFill.style.width = '100%';
        setText(d.progText, `🎯 고정 사냥 · 처치 ${fmt(g.killCount(tg.z, tg.mi))}`);
      } else if (rt.retry > 0) {
        d.progFill.style.width = (1 - rt.retry / 30) * 100 + '%';
        setText(d.progText, `▶ 자동 진행 · 재정비 ${rt.retry}마리 남음`);
      } else {
        d.progFill.style.width = (Math.min(rt.streak, AUTO_STREAK) / AUTO_STREAK) * 100 + '%';
        setText(d.progText, `▶ 자동 진행 · ${Math.min(rt.streak, AUTO_STREAK)} / ${AUTO_STREAK}`);
      }
    }
    // 지도 버튼: 보스를 잡을 수 있는데 아직 다음 지역이 안 열렸으면 강조
    d.bossBtn.classList.toggle('pulse', !s.settings.autoProgress && tg.z === s.maxZone && tg.mi === 4 && g.killCount(tg.z, 4) >= AUTO_STREAK);

    this.updateSpeed();
    this.updateSkills();
    for (const u of this.updaters) u();
    if ((this.tab === 'gear' || this.tab === 'hero') && rt.invDirty) this.showTab(this.tab, true);
    if (this.tab === 'life' && this.lifeDirty) this.showTab('life', true);
    if (this.tab === 'adv' && this.advDirty) this.showTab('adv', true);
    this.advBtn ||= $('.tabs button[data-tab="adv"]');
    if (this.advBtn) this.advBtn.classList.toggle('dot', questClaimable(s));
    rt.invDirty = false;

    while (rt.toasts.length) {
      const t = rt.toasts.shift();
      this.toast(t.text, t.kind);
    }
  }

  // ---------- 토스트 / 모달 ----------
  toast(text, kind = '') {
    const el = h('div', 'toast ' + kind);
    el.textContent = text;
    this.dom.toasts.appendChild(el);
    while (this.dom.toasts.children.length > 3) this.dom.toasts.firstChild.remove();
    setTimeout(() => el.classList.add('out'), 2600);
    setTimeout(() => el.remove(), 3100);
  }

  modal(title, bodyHtml, buttons = [{ label: '확인' }]) {
    const box = this.dom.modalBox;
    box.innerHTML = `<h2>${title}</h2><div class="mbody">${bodyHtml}</div><div class="mbtns"></div>`;
    const wrap = $('.mbtns', box);
    for (const b of buttons) {
      const el = h('button', 'btn ' + (b.cls || ''), b.label);
      el.addEventListener('click', () => {
        const keep = b.onClick ? b.onClick(box) : false;
        if (!keep) this.closeModal();
      });
      wrap.appendChild(el);
    }
    if (this.dom.modal.classList.contains('hidden')) {
      this.modalNav = !!this.navStack;
      this.pushNav(() => this.closeModal(true));
    }
    this.dom.modal.classList.remove('hidden');
    return box;
  }

  // fromBack: 뒤로가기로 닫힘 (기록을 이미 지웠음)
  closeModal(fromBack = false) {
    if (this.dom.modal.classList.contains('hidden')) return;
    this.dom.modal.classList.add('hidden');
    if (this.modalNav) {
      this.modalNav = false;
      if (!fromBack) this.dropNav();
    }
  }

  showOffline(r) {
    this.modal('🌙 돌아오셨군요!', `
      <p>자리를 비운 <b>${fmtTime(r.sec)}</b> 동안 원정대가 계속 싸웠습니다.</p>
      <div class="reward">💰 <b>${fmt(r.gold)}</b> 골드</div>
      <p class="muted">처치 ${fmt(r.kills)} · 장비 ${fmt(r.drops || 0)}개 · 전리품 ${fmt(r.bones || 0)}개 · 최대 오프라인 ${fmtTime(this.game.offlineCapSec())}</p>
      ${r.life ? lifeLines(r.life) : ''}`,
    [{ label: '받기', cls: 'primary' }]);
  }

  // ---------- 전투 화면 아래: 전투 방식 선택 + 정확한 능력치 ----------
  buildSkills() {
    const g = this.game;
    const wrap = this.dom.skills;
    wrap.innerHTML = '';
    wrap.className = 'statbar';
    const row = h('div', 'stylesel');
    this.styleBtns = STYLE_IDS.map((id) => {
      const b = h('button', 'stybtn', `<span>${STYLES[id].icon} ${STYLES[id].name}</span><b></b>`);
      b.addEventListener('click', () => {
        g.setStyle(id);
        this.toast(`전투 방식: ${STYLES[id].icon} ${STYLES[id].name}`, 'good');
        if (this.tab === 'hero' || this.tab === 'gear') this.showTab(this.tab, true);
      });
      row.appendChild(b);
      return { id, b, v: $('b', b) };
    });
    wrap.appendChild(row);
    this.statLine = h('div', 'statline');
    wrap.appendChild(this.statLine);
  }

  updateSkills() {
    const g = this.game;
    const st = g.stats();
    const cur = g.style();
    for (const { id, b, v } of this.styleBtns) {
      b.classList.toggle('on', id === cur);
      setText(v, exact(st[STYLES[id].stat]));
    }
    setText(this.statLine, `❤️ ${exact(Math.max(0, g.rt.heroHp))}/${exact(st.hp)} · 🛡️ ${exact(st.def)} · 🎯 ${pct(st.crit)} · DPS ${exact(g.totalDps())} · ⚔ ${fmt(g.powerScore())}`);
  }

  // 정확한 능력치 표 (영웅 탭 · 장비 탭)
  exactStatsCard(panel) {
    const g = this.game;
    const cur = g.style();
    const card = h('div', 'card stats exactstats');
    const mark = (sid) => (cur === sid ? ' ◀' : '');
    const fields = [
      ['⚔️ 근접' + mark('melee'), (st) => exact(st.melee)],
      ['🏹 원거리' + mark('ranged'), (st) => exact(st.rng)],
      ['🔮 마법' + mark('magic'), (st) => exact(st.mag)],
      ['🛡️ 방어', (st) => exact(st.def)],
      ['❤️ 체력', (st) => `${exact(Math.max(0, g.rt.heroHp))} / ${exact(st.hp)}`],
      ['🎯 치명타', (st) => capTxt(st.crit, STAT_CAPS.crit)],
      ['🧛 흡혈', (st) => capTxt(st.ls, STAT_CAPS.ls)],
      ['🧱 피해 감소', (st) => capTxt(st.dr, STAT_CAPS.dr)],
      ['💚 추가 회복', (st) => capTxt(st.regen, STAT_CAPS.regen)],
      ['★ 모든 피해', (st) => capTxt(st.dmg - 1, STAT_CAPS.dmg), 1],
      ['★ 보스 피해', (st) => capTxt(st.boss, STAT_CAPS.boss), 1],
      ['★ 방어 무시', (st) => capTxt(st.pen, STAT_CAPS.pen), 1],
      ['★ 치명타 피해', (st) => capTxt(st.cdmg - CRIT_MULT, STAT_CAPS.cdmg), 1],
      ['★ 공격 속도', (st) => capTxt(st.spd, STAT_CAPS.spd), 1],
      ['★ 골드', (st) => capTxt(st.gold, STAT_CAPS.gold), 1],
      ['★ 드롭률', (st) => capTxt(st.drop, STAT_CAPS.drop), 1],
      ['💨 공격 속도', () => g.atkSpeed().toFixed(2) + '/초'],
      ['🗡️ 피해 범위', () => `${exact(g.maxHit() * g.minHitFrac())} ~ ${exact(g.maxHit())}`],
      ['📈 DPS', () => exact(g.totalDps())],
      ['💥 받는 피해', () => { const m = g.rt.monster || { str: 0 }; return exact(incomingHit(m.str, g.stats().def) * (1 - g.stats().dr)) + '/회'; }],
      ['🍀 드롭률 배율', () => 'x' + g.lootMult().toFixed(2)],
      ['⚔ 전투력', () => exact(g.powerScore())],
    ];
    const capTxt = (v, cap) => `${pct(v)}<small> / ${pct(cap)}</small>`;
    const vals = fields.map(([label, , sp]) => {
      const it = h('div', 'stat' + (sp ? ' spstat' : ''), `<span>${label}</span><b></b>`);
      card.appendChild(it);
      return $('b', it);
    });
    this.updaters.push(() => { const st = g.stats(); fields.forEach(([, f], i) => { const v = f(st); if (vals[i].innerHTML !== v) vals[i].innerHTML = v; }); });
    panel.appendChild(card);
  }

  // 스탯 분석 · 추천: 지금 몬스터 기준으로 어떤 스탯을 올리면 가장 빨리 강해지는지
  analysisCard(panel) {
    const g = this.game;
    const card = h('details', 'card analysis');
    this.anaOpen ??= true;
    card.open = this.anaOpen;
    card.addEventListener('toggle', () => { this.anaOpen = card.open; });
    panel.appendChild(card);
    let last = 0;
    const draw = () => {
      const a = g.analyze();
      const sty = STYLES[g.style()];
      const best = [...a.styles].sort((x, y) => y.kpm - x.kpm)[0];
      const pmode = this.anaMode === 'power';
      const list = pmode ? a.prows : a.rows;
      const pc = (v) => (v > 0.00005 ? '+' + (v * 100).toFixed(2) + '%' : '-');
      const n = a.now;
      const life = n.killsPerLife === Infinity ? '체력이 줄지 않음 (안정)' : `한 번 쓰러질 때까지 약 ${exact(n.killsPerLife)}마리`;
      const top = list.filter((r) => r.gain > 0.00005).slice(0, 3);
      const tip = a.danger
        ? '⚠️ 지금 몬스터에게 자주 쓰러집니다. 생존 스탯(아래 순위)부터 올리거나 더 약한 몬스터를 고르세요.'
        : '✅ 생존은 안정적입니다. 공격 스탯을 올릴수록 사냥이 빨라집니다.';
      const open = card.open;
      card.innerHTML = `<summary>📊 스탯 분석 · 추천 (${sty.icon} ${sty.name} 기준, ${a.m.name || '지금 몬스터'})</summary>
        <div class="muted lnote">처치 시간 ${n.ttk.toFixed(1)}초 · 초당 받는 피해 ${exact(n.inc)} · 초당 회복 ${exact(n.heal)} · ${life} · 분당 처치 ${n.kpm.toFixed(1)}마리</div>
        <div class="anatip">${tip}</div>
        <div class="anamode"><button class="btn small${pmode ? '' : ' primary'}" data-m="real">🗡️ 실제 전투 기준</button><button class="btn small${pmode ? ' primary' : ''}" data-m="power">⚔ 전투력 기준</button></div>
        <div class="anahead">${pmode ? '추천 순위 · 전투력(순수한 강함) 기준: 각 스탯 1%씩 올렸을 때 전투력 증가' : `추천 순위 · 실제 전투 기준: 각 스탯 1%씩 올렸을 때 ${a.m.name || '지금 몬스터'} 분당 처치 증가`} · 최대치에 도달한 스탯은 제외</div>
        <div class="lrow lhead"><span>스탯</span><b>${pmode ? '<u>전투력</u> · 실전' : '<u>실전</u> · 전투력'}</b></div>
        ${list.map((r, i) => `<div class="lrow${i < 3 && r.gain > 0.00005 ? ' best' : ''}${r.sp ? ' sprow' : ''}"><span>${i + 1}. ${r.label}</span><b>${r.gain > 0.00005 ? '+' + (r.gain * 100).toFixed(2) + '%' : '효과 거의 없음'} <small class="muted">· ${pc(pmode ? r.real : r.power)}</small></b></div>`).join('')}
        <div class="anahead">지금 장비로 방식별 비교</div>
        ${a.styles.map((x) => `<div class="lrow${x.id === best.id ? ' best' : ''}"><span>${STYLES[x.id].icon} ${STYLES[x.id].name}${x.id === g.style() ? ' (사용 중)' : ''}</span><b>⚔ ${fmt(x.power)} · DPS ${exact(x.dps)} · 분당 ${x.kpm.toFixed(1)}마리</b></div>`).join('')}
        <div class="muted lnote">${best.id !== g.style() ? `💡 지금 장비로는 ${STYLES[best.id].icon} ${STYLES[best.id].name}이(가) 더 강합니다. 아래에서 바꿀 수 있습니다.` : '💡 지금 고른 방식이 가장 강합니다.'}
        ${top.length ? ` 가장 효율 좋은 스탯: ${top.map((r) => r.label).join(', ')}.` : ''}
        근접은 근접 수치, 원거리는 원거리 수치, 마법은 마법 수치(몬스터 방어를 일부 무시해 방어가 높은 몬스터에 유리)만 피해에 쓰입니다. 치명타는 공격 수치가 높을수록, 방어 · 체력 · 흡혈은 자주 쓰러질수록 효율이 올라갑니다.</div>`;
      card.open = open;
      card.querySelectorAll('.anamode button').forEach((b) => b.addEventListener('click', (ev) => { ev.preventDefault(); this.anaMode = b.dataset.m; draw(); }));
    };
    draw();
    this.updaters.push(() => { const now = performance.now(); if (now - last > 3000) { last = now; draw(); } });
  }

  // 전투 방식 선택 카드
  styleCard(panel) {
    const g = this.game;
    const cur = g.style();
    const card = h('div', 'card stylecard', `<div><b>전투 방식</b> <span class="muted">· 직접 선택 (장비마다 근접 · 원거리 · 마법 수치가 따로 붙어 있음)</span></div><div class="stylesel"></div><div class="muted">${STYLES[cur].desc}</div>`);
    const row = $('.stylesel', card);
    const st = g.stats();
    for (const id of STYLE_IDS) {
      const b = h('button', 'stybtn' + (id === cur ? ' on' : ''), `<span>${STYLES[id].icon} ${STYLES[id].name}</span><b>${exact(st[STYLES[id].stat])}</b>`);
      b.addEventListener('click', () => { g.setStyle(id); this.showTab(this.tab, true); });
      row.appendChild(b);
    }
    panel.appendChild(card);
  }

  // ---------- 탭 ----------
  showTab(id, keepScroll = false) {
    const scroll = this.dom.panel.scrollTop;
    this.tab = id;
    document.body.classList.toggle('tab-gear', id === 'gear');
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === id));
    this.dom.panel.innerHTML = '';
    this.updaters = [];
    this.lifeDirty = false;
    this.advDirty = false;
    const fn = {
      hero: this.tabHero, gear: this.tabGear, life: this.tabLife, adv: this.tabAdv, more: this.tabMore,
    }[id];
    fn.call(this, this.dom.panel);
    for (const u of this.updaters) u();
    this.dom.panel.scrollTop = keepScroll ? scroll : 0;
  }

  tabHero(panel) {
    const g = this.game;
    const s = g.s;
    const mon = () => g.rt.monster || { def: 0, str: 0 };
    panel.appendChild(h('div', 'section-title', '⚔️ 능력치 (장비 · 잠재능력 · 기도 · 펫 · 박물관 합산)'));
    this.styleCard(panel);
    this.exactStatsCard(panel);
    this.analysisCard(panel);
    const pw = h('div', 'card note power');
    panel.appendChild(pw);
    // 음식: 낚시 → 요리 → 전투 중 자동 섭취
    const food = h('div', 'card note');
    panel.appendChild(food);
    this.updaters.push(() => {
      const id = bestFood(s);
      const L = s.life;
      setText(food, !L.autoEat ? '🍽️ 음식 자동 섭취 꺼짐 (생활 → 창고에서 켜기)'
        : id ? `🍽️ 체력 40% 미만이면 자동으로 먹음 · 다음: ${MATS[id].icon} ${MATS[id].name} (회복 ${Math.round(MATS[id].heal * 100)}%) · 음식 ${fmt(foodCount(s))}개`
          : '🍽️ 음식 없음 · 🎣 낚시나 사냥으로 얻은 물고기 · 고기를 🍳 요리하면 전투 중 자동으로 먹고 체력을 회복합니다');
    });
    const wx = h('div', 'card note');
    panel.appendChild(wx);
    this.updaters.push(() => {
      const c = climate();
      const p = activePet(s);
      setText(wx, `${c.weather.icon} ${c.weather.name} · ${c.season.icon} ${c.season.name} · ${p ? p.icon + ' ' + p.name : '펫 없음'} (자세한 효과는 🗺️ 모험 탭)`);
    });
    this.updaters.push(() => setText(pw, `전투력 ${fmt(g.powerScore())} · ${mon().e || ''} ${mon().name || ''} Lv ${s.stage} 체력 ${fmt(mon().maxHp || 0)} · 방어 ${fmt(mon().def)} · 힘 ${fmt(mon().str)}`));

    // 지금 몬스터의 전리품 표
    const loot = h('details', 'card loottable');
    panel.appendChild(loot);
    let lootSig = '';
    this.updaters.push(() => {
      const m = g.rt.monster;
      const sig = `${s.target.z}/${s.target.mi}/${g.lootMult().toFixed(3)}`;
      if (sig === lootSig) return;
      lootSig = sig;
      const lm = g.lootMult();
      const rows = g.monsterLoot(m).map((d) => {
        const p = Math.min(1, d.c * lm);
        const label = d.mat ? `${MATS[d.mat].icon} ${MATS[d.mat].unique ? '<b>' + MATS[d.mat].name + '</b>' : MATS[d.mat].name} ${d.q[0] === d.q[1] ? d.q[0] : d.q[0] + '~' + d.q[1]}`
          : `${d.kind ? WICON[d.kind] : SLOTS[d.slot].icon} ${itemName({ ...d, lvl: s.stage, r: 0, enh: 0 })}${d.aff ? ' (' + STYLES[d.aff].name + ')' : ''}`;
        return `<div class="lrow"><span>${label}</span><b>${fmtPct(p, p < 0.01 ? 2 : 1)}</b></div>`;
      }).join('');
      const open = loot.open;
      loot.innerHTML = `<summary>🎁 전리품 표 · ${m ? m.e + ' ' + m.name : ''} (드롭률 x${lm.toFixed(2)} 적용)</summary>${rows}<div class="muted lnote">각 항목을 따로 굴립니다. <b>굵은 글씨</b>는 이 몬스터의 고유 전리품(박물관 · 제작 · 연금술 등에 사용). 장비 등급은 따로 정해지고, 보스는 고등급 장비를 추가로 줍니다.</div>`;
      loot.open = open;
    });

    panel.appendChild(h('div', 'section-title', '🎽 장착 장비'));
    const wrap = h('div');
    panel.appendChild(wrap);
    const build = () => {
      wrap.innerHTML = '';
      for (const slot of SLOT_IDS) {
        const it = s.equip[slot];
        if (it) wrap.appendChild(this.itemCard(it, true));
        else {
          const off = slot === 'shield' && g.twoHanded();
          wrap.appendChild(h('div', 'item empty', `<div class="iicon">${SLOTS[slot].icon}</div><div class="iinfo"><div class="iname">${SLOTS[slot].name} 없음</div><div class="istat">${off ? '양손 무기 착용 중' : '몬스터 전리품 · 대장기술 · 제작으로 획득'}</div></div>`));
        }
      }
    };
    build();
    this.heroRebuild = build;
  }

  itemCard(it, equipped, noEnh = false) {
    const g = this.game;
    const rar = RARITIES[it.r];
    const icon = it.slot === 'weapon' ? WICON[it.kind || 'sword'] : SLOTS[it.slot].icon;
    const ist = itemStyle(it);
    const styTag = ist ? ` <span class="stag s-${ist}">주력 ${STYLES[ist].name}</span>` : '';
    const sd = equipped ? g.slotData(it.slot) : null;
    const potTag = sd?.pot ? `<div class="potline" style="color:${POT_TIERS[sd.pot.t].color}">◆ 칸 잠재 ${POT_TIERS[sd.pot.t].name} · ${sd.pot.lines.map(([k, v]) => bonusText({ [k]: v })).join(' / ')}</div>` : '';
    // 기본 옵션(부위 · 종류 · 등급 · 재질로 고정)과 ★ 특수 옵션(부위마다 고정, 희귀부터)을 나눠 표시
    const baseSt = itemStats(sd?.enh ? { ...it, enh: sd.enh } : it);
    const spKey = ITEM_SP[it.slot];
    let spTag = '';
    if (spKey) {
      if (hasItemSp(it)) {
        const v = itemSpValue(it);
        baseSt[spKey] -= v;
        if (baseSt[spKey] < 1e-9) delete baseSt[spKey];
        spTag = `<div class="ispline">★ 특수 옵션 · ${STAT_NAMES[spKey]} +${statVal(spKey, v)}</div>`;
      } else spTag = `<div class="ispline off">★ 특수 옵션 · ${STAT_NAMES[spKey]} (희귀 등급부터)</div>`;
    }
    const el = h('div', 'item' + (equipped ? ' equipped' : ''));
    el.style.setProperty('--rc', rar.color);
    let diff = '';
    if (!equipped) {
      diff = pwrSpan(g.equipDelta(it));
    }
    const inactive = equipped && it.slot === 'shield' && g.twoHanded();
    const wd = it.slot === 'weapon' ? WEAPONS[it.kind || 'sword'] : null;
    const extra = wd ? ` · 속도 ${wd.speed}${wd.minHit ? ' · 최소피해+' + Math.round(wd.minHit * 100) + '%' : ''}${wd.twoHand ? ' · 양손' : ''}` : '';
    el.innerHTML = `
      <div class="iicon">${icon}</div>
      <div class="iinfo">
        <div class="iname"><span class="rtag" style="color:${rar.color}">[${rar.name}]</span> ${itemName(it)}${sd?.enh ? ` <span class="stag">칸 +${sd.enh}</span>` : ''}${styTag}</div>
        <div class="istat">${statText(baseSt)}${extra} ${diff}${inactive ? ' <span class="diff down">양손 무기로 비활성</span>' : ''}</div>${spTag}${potTag}
      </div>
      <div class="ibtns"></div>`;
    const btns = $('.ibtns', el);
    if (equipped) {
      const enh = noEnh ? null : this.slotEnhBtn(it.slot);
      const off = h('button', 'btn small', '해제');
      off.addEventListener('click', () => { if (g.unequip(it.slot)) this.showTab(this.tab, true); else this.toast('가방이 가득 찼습니다', 'bad'); });
      btns.append(...(enh ? [enh] : []), off);
    } else {
      const eb = h('button', 'btn small primary', '장착');
      eb.addEventListener('click', () => { g.equipItem(it.id); this.showTab(this.tab, true); });
      const sb = h('button', 'btn small', `판매<br><small>💰 ${fmt(itemSellPrice(it))}</small>`);
      sb.addEventListener('click', () => { g.sellItem(it.id); this.showTab(this.tab, true); });
      btns.append(eb, sb);
    }
    return el;
  }

  tabGear(panel) {
    const g = this.game;
    const s = g.s;
    // 가방 / 조합 창 전환
    this.gearView ||= 'bag';
    const seg = h('div', 'buybar');
    for (const [v, label] of [['bag', `🎒 가방 (${s.inv.length})`], ['combine', '⚒️ 조합'], ['cube', '🎲 큐브']]) {
      const b = h('button', this.gearView === v ? 'on' : '', label);
      b.addEventListener('click', () => this.navTo(() => { this.gearView = v; this.showTab('gear', true); }));
      seg.appendChild(b);
    }
    panel.appendChild(seg);
    if (this.gearView === 'bag') this.paperDoll(panel);
    // 정확한 능력치 (접어 둘 수 있음)
    const sbox = h('details', 'card gearstats');
    this.gearStatsOpen ??= false;
    sbox.open = this.gearStatsOpen;
    sbox.addEventListener('toggle', () => { this.gearStatsOpen = sbox.open; });
    sbox.appendChild(h('summary', '', `📊 능력치 · ${STYLES[g.style()].icon} ${STYLES[g.style()].name}`));
    this.exactStatsCard(sbox);
    panel.appendChild(sbox);
    if (this.gearView === 'cube') { this.gearCube(panel); return; }
    panel.appendChild(this.autoCombineCard());
    if (this.gearView === 'combine') { this.gearCombine(panel); return; }
    const opts = h('div', 'card opts');
    const sellOpts = ['끄기', ...RARITIES.slice(1, 9).map((r, i) => `${RARITIES[i].name} 이하`)];
    opts.innerHTML = `
      <label class="toggle"><input type="checkbox" id="optAutoEquip"> 더 좋은 장비 자동 장착</label>
      <label class="toggle"><input type="checkbox" id="optAutoMuseum"> 🏛️ 고유 전리품 박물관 자동 기증</label>
      <label class="toggle"><input type="checkbox" id="optSellLower"> 착용 장비보다 하위 재질 장비 자동 판매</label>
      <div class="muted">상위 재질 장비는 자동 판매하지 않음(조합 재료로 보관) · 하위 재질 장비는 등급이 높아도 자동 교체하지 않음 · 재질이 한 단계 높으면 수치 x1.35</div>
      <label>자동 판매 <select id="optAutoSell">${sellOpts.map((o, i) => `<option value="${i}">${o}</option>`).join('')}</select></label>
      <div class="muted">드롭률 6% · 보스는 등급을 4번, 지역 보스는 8번 굴려 가장 좋은 등급 · 최고 획득 등급 <b style="color:${RARITIES[s.stats.bestRarity || 0].color}">${RARITIES[s.stats.bestRarity || 0].name}</b></div>`;
    panel.appendChild(opts);
    const ae = $('#optAutoEquip', opts);
    ae.checked = s.settings.autoEquip;
    ae.addEventListener('change', () => { s.settings.autoEquip = ae.checked; });
    const am = $('#optAutoMuseum', opts);
    am.checked = !!s.settings.autoMuseum;
    am.addEventListener('change', () => { s.settings.autoMuseum = am.checked; this.toast(am.checked ? '🏛️ 박물관 자동 기증 켜짐' : '🏛️ 박물관 자동 기증 꺼짐'); });
    const sl = $('#optSellLower', opts);
    sl.checked = !!s.settings.sellLower;
    sl.addEventListener('change', () => { s.settings.sellLower = sl.checked; });
    const as = $('#optAutoSell', opts);
    as.value = String(Math.min(s.settings.autoSell, sellOpts.length - 1));
    as.addEventListener('change', () => { s.settings.autoSell = Number(as.value); });

    // 등급표
    const tbl = h('details', 'card rartable', `<summary>장비 등급 ${RARITIES.length}단계 보기</summary><div class="rgrid">${RARITIES.map((r) => `<span style="color:${r.color}">${r.name} x${r.mult}</span>`).join('')}</div>`);
    panel.appendChild(tbl);

    const head = h('div', 'section-title', `가방 (${s.inv.length})`);
    const bulk = h('button', 'btn small', '희귀 이하 일괄 판매');
    bulk.addEventListener('click', () => {
      const r = g.sellBelow(2);
      if (r.count) this.toast(`${r.count}개 판매: 💰 ${fmt(r.total)}`, 'good');
    });
    head.appendChild(bulk);
    panel.appendChild(head);
    if (!s.inv.length) panel.appendChild(h('div', 'muted center pad', '가방이 비어 있습니다'));
    // 가방은 무제한: 한 번에 그리는 수를 제한하고 '더 보기'
    const sorted = [...s.inv].sort((a, b) => g.upgradeGain(b) - g.upgradeGain(a));
    this.bagShow ||= 40;
    for (const it of sorted.slice(0, this.bagShow)) panel.appendChild(this.itemCard(it, false));
    if (sorted.length > this.bagShow) {
      const more = h('button', 'btn', `더 보기 (${sorted.length - this.bagShow}개 남음)`);
      more.style.width = '100%';
      more.addEventListener('click', () => { this.bagShow += 40; this.showTab('gear', true); });
      panel.appendChild(more);
    }
  }

  // 큐브 탭: 장착 · 가방 장비 목록 → 누르면 큐브 창
  gearCube(panel) {
    const g = this.game;
    const s = g.s;
    panel.appendChild(h('div', 'card note', `🎲 잠재 큐브 <b>${exact(s.life.bank.cube || 0)}</b>개 · 잠재능력은 <b>장비칸</b>에 붙습니다 (장비를 바꿔도 그대로, 장비를 낀 칸만 적용). 칸을 누르면 큐브 창이 열립니다. 잠재능력 등급은 장비 등급과 같은 ${POT_TIERS.length}단계이고, 같은 등급에서 일정 횟수를 돌리면 다음 등급이 확정(천장)됩니다. 부위마다 <b class="sptxt">★ 특수 옵션</b> 1개가 ${POT_TIERS[POT_SP_MIN].name} 등급부터 나오며 수치가 훨씬 큽니다 (${SLOT_IDS.map((sl) => `${SLOTS[sl].name} ${BONUS_NAMES[POT_SPECIAL[sl]]}`).join(' · ')}). 골드 · 드롭률은 특수 옵션으로만 나옵니다. 같은 옵션이 여러 줄에 겹쳐 나올 수 있습니다.`));
    for (const sl of DOLL) {
      const x = g.slotData(sl);
      const eq = s.equip[sl];
      const b = h('button', 'cuberow', `
        <span class="ci">${eq ? itemIcon(eq) : SLOTS[sl].icon}</span>
        <span class="cn"><b>${SLOTS[sl].name} 칸 <small>+${x.enh}</small></b>${eq ? `<small style="color:${RARITIES[eq.r].color}">${itemName(eq)}</small>` : '<small>비어 있음 (효과 없음)</small>'}<small>${x.pot ? `<span style="color:${POT_TIERS[x.pot.t].color}">${POT_TIERS[x.pot.t].name}</span> · ${x.pot.lines.map(([k, v]) => bonusText({ [k]: v })).join(' / ')}` : '잠재능력 없음'}</small></span>`);
      b.addEventListener('click', () => this.openCube(x.id));
      panel.appendChild(b);
    }
  }

  // 큐브 창: 배경을 어둡게 하고 가운데에서 비포 · 애프터 비교, 잠금, 자동 돌리기
  openCube(id) {
    const g = this.game;
    const s = g.s;
    if (!g.findItem(id)) return;
    this.closeCube?.();
    const ov = h('div', 'cubeov');
    const win = h('div', 'cubewin');
    ov.appendChild(win);
    document.body.appendChild(ov);
    const cfg = (this.cubeCfg ||= { tier: -1, keys: [], n: 1, gold: false });
    let auto = null;
    let spinning = false;
    let opened = null; // 잠재능력이 없던 장비를 처음 연 결과
    let rolls = 0;
    const stopAuto = (why) => {
      if (auto) { clearInterval(auto); auto = null; if (why) this.toast(why, 'good'); }
    };
    const close = (fromBack = false) => { stopAuto(); ov.remove(); this.closeCube = null; if (!fromBack) this.dropNav(); this.showTab(this.tab, true); };
    this.pushNav(() => close(true));
    this.closeCube = close;
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });

    const lineRow = (k, v, extra = '') => `<span>${bonusText({ [k]: v })}</span>${extra}`;
    const potBox = (pot, side, it) => {
      if (!pot) return `<div class="cpot empty">잠재능력 없음<br><small>한 번 돌리면 열립니다</small></div>`;
      const T = POT_TIERS[pot.t];
      const locks = side === 'before' ? g.potLocks(it) : [];
      const want = new Set(cfg.keys);
      return `<div class="cpot" style="--pc:${T.color}"><div class="ctier">${T.name}</div>${pot.lines.map(([k, v], i) => {
        const lk = side === 'before' ? `<button class="lockbtn${locks.includes(i) ? ' on' : ''}" data-i="${i}" title="이 줄 잠그기">${locks.includes(i) ? '🔒' : '🔓'}</button>` : '';
        return `<div class="cline${want.has(k) ? ' want' : ''}${locks.includes(i) ? ' locked' : ''}${isSp(k) ? ' sp' : ''}">${lineRow(k, v)}${lk}</div>`;
      }).join('')}</div>`;
    };
    const keysFor = (it) => potPool(it.slot, POT_TIERS.length - 1).map((l) => l.key);
    const isSp = (k) => !!POT_LINES.find((l) => l.key === k)?.sp;

    const draw = () => {
      const it = g.findItem(id);
      if (!it) { close(); return; }
      const isPet = it.slot === 'pet';
      const pid = isPet ? it.id.slice(4) : null;
      const eqIt = isPet ? null : s.equip[it.slot];
      const rar = isPet ? { name: '펫', color: '#ffd27a' } : { name: SLOTS[it.slot].name + ' 칸', color: eqIt ? RARITIES[eqIt.r].color : '#aaa' };
      const nL = g.potLines(it);
      const active = isPet ? s.world.pets.active === pid : !!eqIt;
      const cd = it.potNew && active ? g.cubeDelta(it) : null;
      const t = it.pot?.t ?? 0;
      const T = POT_TIERS[t];
      const need = g.cubeNeed(it);
      const bank = s.life.bank.cube || 0;
      const sp = POT_SPECIAL[it.slot] ? `<b class="sptxt">${BONUS_NAMES[POT_SPECIAL[it.slot]]}</b> (${POT_TIERS[POT_SP_MIN].name} 등급부터, 수치 큼)` : '';
      const after = it.potNew || opened;
      cfg.keys = cfg.keys.filter((k) => keysFor(it).includes(k));
      if (cfg.tier <= t) cfg.tier = -1;
      win.innerHTML = `
        <div class="cwhead"><span class="ci">${isPet ? itemIcon(it) : eqIt ? itemIcon(eqIt) : SLOTS[it.slot].icon}</span>
          <div class="cwname"><b style="color:${rar.color}">[${rar.name}] ${isPet ? PET[pid].name : eqIt ? itemName(eqIt) : '비어 있음'}</b> <small>+${it.enh || 0}</small>${active ? ` <span class="stag">${isPet ? '데리고 다니는 중' : '장착 중'}</span>` : ''}
          <div class="muted">${isPet ? petEnhText(it) + ` · 잠재능력 ${nL}줄` : eqIt ? statText(itemStats(it.enh ? { ...eqIt, enh: it.enh } : eqIt)) + ' · 잠재능력은 이 칸에 붙음' : '장비를 끼면 칸 강화 · 잠재능력이 적용됩니다'}</div></div>
          <button class="btn small cwx">✖</button></div>
        <div class="cwtier">잠재 등급 <b style="color:${T.color}">${T.name}</b> (${t + 1}/${POT_TIERS.length}) · 수치 x${T.mult.toFixed(2)}
          ${T.up ? `<br>다음 등급 <b style="color:${POT_TIERS[t + 1].color}">${POT_TIERS[t + 1].name}</b> 확률 ${(T.up * 100).toFixed(2)}% · 천장 <b>${Math.min(it.pity || 0, T.pity)}/${T.pity}</b>
          <div class="pitybar"><div style="width:${Math.min(100, ((it.pity || 0) / T.pity) * 100)}%;background:${POT_TIERS[t + 1].color}"></div></div>` : '<br>최고 등급입니다'}</div>
        <div class="cwcols">
          <div class="cwcol"><div class="cwlab">BEFORE · 지금</div>${potBox(it.pot === after ? null : it.pot, 'before', it)}</div>
          <div class="cwarrow">➜</div>
          <div class="cwcol"><div class="cwlab">AFTER · 새 결과</div><div class="afterbox">${after ? potBox(after, 'after', it) : '<div class="cpot empty">🎲 돌려 보세요</div>'}</div></div>
        </div>
        <div class="cwbtns">
          <button class="btn primary cwroll">🎲 돌리기<br><small>${bank >= need ? `큐브 ${need}개` : `💰 ${fmt(g.cubeCost(it))}`}</small></button>
          <button class="btn cwok"${it.potNew ? '' : ' disabled'}>✅ AFTER 적용${it.potNew ? `<br><small>${cd === null ? (isPet ? '데리고 다닐 때 반영' : '장비를 끼면 반영') : pwr(cd)}</small>` : ''}</button>
          <button class="btn cwkeep"${it.potNew ? '' : ' disabled'}>↩️ BEFORE 유지</button>
        </div>
        <div class="muted lnote">🎲 보유 큐브 ${exact(bank)}개 · 🔒 잠금 ${g.potLocks(it).length}/${nL - 1} (잠근 줄 수에 따라 큐브 ${POT_LOCK_COST.slice(1, nL).map((x) => 'x' + x).join(' / ')}) · 등급이 오르면 적용 여부와 상관없이 유지 · 특수 옵션: ${sp || '없음'}</div>
        <details class="cwauto"${this.cubeAutoOpen ? ' open' : ''}><summary>⏩ 자동 돌리기 · 원하는 결과에서 멈춤</summary>
          <label>목표 등급 <select class="atier"><option value="-1">설정 안 함</option>${POT_TIERS.map((p, i) => (i > t ? `<option value="${i}"${cfg.tier === i ? ' selected' : ''}>${p.name}</option>` : '')).join('')}</select></label>
          <div class="muted">원하는 옵션 (여러 개 고르면 그중 하나라도 해당)</div>
          <div class="chips">${POT_LINES.map(({ key: k }) => { const can = keysFor(it).includes(k); return `<button class="chip${isSp(k) ? ' sp' : ''}${cfg.keys.includes(k) && can ? ' on' : ''}${can ? '' : ' no'}" data-k="${k}"${can ? '' : ' disabled'}>${isSp(k) ? '★ ' : ''}${BONUS_NAMES[k]}</button>`; }).join('')}</div>
          <div class="muted">★ 특수 옵션 · 어두운 옵션은 이 부위에 나오지 않습니다</div>
          <label>원하는 옵션이 <select class="an">${Array.from({ length: nL }, (_, i) => i + 1).map((n) => `<option value="${n}"${cfg.n === n ? ' selected' : ''}>${n}줄 이상</option>`).join('')}</select> 나오면 멈춤</label>
          <label class="toggle"><input type="checkbox" class="agold"${cfg.gold ? ' checked' : ''}> 큐브가 떨어지면 골드로 계속</label>
          <div class="muted">목표 등급과 옵션을 둘 다 고르면 둘 다 만족할 때 멈춥니다.${auto ? ` · 자동 진행 ${rolls}회` : ''}</div>
          <button class="btn ${auto ? '' : 'primary'} cwauto-btn">${auto ? '■ 멈춤' : '▶ 자동 시작'}</button>
        </details>`;
      $('.cwx', win).addEventListener('click', () => close());
      $('.cwauto', win).addEventListener('toggle', (e) => { this.cubeAutoOpen = e.target.open; });
      win.querySelectorAll('.lockbtn').forEach((b) => b.addEventListener('click', () => {
        if (!g.toggleLock(it.id, Number(b.dataset.i))) this.toast(`최대 ${g.potLines(it) - 1}줄까지 잠글 수 있습니다`, 'bad');
        draw();
      }));
      $('.cwroll', win).addEventListener('click', () => { stopAuto(); roll(true); });
      $('.cwok', win).addEventListener('click', () => { g.decideCube(it.id, true); opened = null; draw(); });
      $('.cwkeep', win).addEventListener('click', () => { g.decideCube(it.id, false); opened = null; draw(); });
      $('.atier', win).addEventListener('change', (e) => { cfg.tier = Number(e.target.value); });
      $('.an', win).addEventListener('change', (e) => { cfg.n = Number(e.target.value); });
      $('.agold', win).addEventListener('change', (e) => { cfg.gold = e.target.checked; });
      win.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
        const k = b.dataset.k;
        cfg.keys = cfg.keys.includes(k) ? cfg.keys.filter((x) => x !== k) : [...cfg.keys, k];
        b.classList.toggle('on');
      }));
      $('.cwauto-btn', win).addEventListener('click', () => {
        if (auto) { stopAuto(); draw(); return; }
        if (cfg.tier < 0 && !cfg.keys.length) { this.toast('목표 등급이나 원하는 옵션을 골라 주세요', 'bad'); return; }
        rolls = 0;
        auto = setInterval(() => {
          const r = roll(false);
          if (!r) { stopAuto('큐브(또는 골드)가 부족해 멈췄습니다'); draw(); return; }
          rolls++;
          if (done(r)) { stopAuto(`🎯 원하는 결과가 나와 멈췄습니다 (${rolls}회)`); }
          draw();
        }, 110);
        draw();
      });
    };
    // 멈춤 조건
    const done = (res) => {
      const okT = cfg.tier < 0 || res.t >= cfg.tier;
      const okK = !cfg.keys.length || res.lines.filter(([k]) => cfg.keys.includes(k)).length >= cfg.n;
      return okT && okK;
    };
    // 한 번 돌리기 (anim: 수동일 때 슬롯처럼 섞이는 연출)
    const roll = (anim) => {
      if (spinning) return null;
      const it = g.findItem(id);
      if (!it) return null;
      const had = !!it.pot;
      // 자동에서는 맞지 않는 새 결과를 버리고 계속
      if (!anim && it.potNew) g.decideCube(it.id, false);
      const r = g.useCube(it.id, anim || cfg.gold);
      if (!r.ok) { if (anim) this.toast(r.why, 'bad'); return null; }
      opened = had ? null : r.res;
      if (r.up) this.toast(`잠재능력 등급 상승! ${POT_TIERS[r.res.t].name}`, r.res.t >= 6 ? 'legend' : 'epic');
      if (anim) {
        spinning = true;
        draw();
        const box = $('.afterbox', win);
        const keys = keysFor(it);
        let n = 0;
        box.classList.add('spin');
        const tmr = setInterval(() => {
          if (++n > 7 || !box.isConnected) {
            clearInterval(tmr);
            spinning = false;
            draw();
            const nb = $('.afterbox', win);
            if (nb) { nb.classList.add('pop'); if (r.up) nb.classList.add('upflash'); }
            return;
          }
          box.innerHTML = `<div class="cpot" style="--pc:${POT_TIERS[r.res.t].color}"><div class="ctier">${POT_TIERS[r.res.t].name}</div>${Array.from({ length: g.potLines(it) }, () => 0).map(() => {
            const k = keys[Math.floor(Math.random() * keys.length)];
            return `<div class="cline">${lineRow(k, potValue(k, r.res.t))}</div>`;
          }).join('')}</div>`;
        }, 55);
      }
      return r.res;
    };
    draw();
  }

  // 장착 칸: 몸에 착용하는 위치대로 3 x 4 네모칸 (빈칸 없이)
  //  망토 · 투구 · 목걸이 / 무기 · 갑옷 · 방패 / 장갑 · 각반 · 보조장비 / 반지 · 장화 · 반지
  paperDoll(panel) {
    const g = this.game;
    const s = g.s;
    const grid = h('div', 'doll');
    for (const sl of DOLL) {
      const it = s.equip[sl];
      const sd = g.slotData(sl);
      const r = it ? RARITIES[it.r] : null;
      const off = sl === 'shield' && g.twoHanded();
      const c = h('button', 'dslot' + (it ? ' has' : '') + (this.dollSel === sl ? ' on' : '') + (off ? ' off' : ''), `
        <span class="dic">${it ? itemIcon(it) : SLOTS[sl].icon}</span>
        ${sd.enh ? `<span class="denh">+${sd.enh}</span>` : ''}
        ${sd.pot ? `<span class="dpot" style="background:${POT_TIERS[sd.pot.t].color}" title="잠재 ${POT_TIERS[sd.pot.t].name}"></span>` : ''}
        <span class="dname">${it ? `<b style="color:${r.color}">${r.name}</b>` : SLOTS[sl].name}</span>`);
      if (r) c.style.setProperty('--rc', r.color);
      c.addEventListener('click', () => this.navTo(() => { this.dollSel = this.dollSel === sl ? null : sl; this.showTab('gear', true); }));
      grid.appendChild(c);
    }
    panel.appendChild(grid);
    const sel = this.dollSel;
    if (!sel) { panel.appendChild(h('div', 'muted center dollhint', '칸을 누르면 자세히 보기 · 칸 강화 · 칸 큐브 (장비를 바꿔도 칸에 남음)')); return; }
    // 장비칸 카드: 칸 강화 · 칸 잠재능력
    const sd = g.slotData(sel);
    const sc = h('div', 'card slotcard', `
      <div><b>${SLOTS[sel].icon} ${SLOTS[sel].name} 칸</b> <small>강화 +${sd.enh} / ${ENHANCE_MAX}</small> <span class="muted">· 장비를 바꿔도 칸에 남음</span></div>
      <div class="potline">${sd.pot ? `<span style="color:${POT_TIERS[sd.pot.t].color}">◆ ${POT_TIERS[sd.pot.t].name}</span> · ${sd.pot.lines.map(([k, v]) => bonusText({ [k]: v })).join(' / ')}` : '잠재능력 없음 (큐브로 개방)'}</div>
      <div class="cubebtns"></div>`);
    const cb = h('button', 'btn', '🎲 칸 큐브');
    cb.addEventListener('click', () => this.openCube(sd.id));
    $('.cubebtns', sc).append(this.slotEnhBtn(sel, 'btn primary'), cb);
    panel.appendChild(sc);
    const it = s.equip[sel];
    if (!it) { panel.appendChild(h('div', 'card muted center', `${SLOTS[sel].name} 칸에 낀 장비가 없습니다 (칸 강화 · 잠재능력은 장비를 끼면 적용)`)); return; }
    panel.appendChild(this.itemCard(it, true, true));
  }

  // 장비칸 강화 버튼 (비용 · 전투력 변화)
  slotEnhBtn(sl, cls = 'btn small') {
    const g = this.game;
    const sd = g.slotData(sl);
    const b = h('button', cls);
    const ed = sd.enh < ENHANCE_MAX && g.s.equip[sl] ? g.enhanceDelta(sd) : 0;
    b.addEventListener('click', () => {
      if (g.enhance(sd.id)) { this.toast(`${SLOTS[sl].name} 칸 +${sd.enh} 강화 성공!`, 'good'); this.showTab(this.tab, true); }
    });
    this.updaters.push(() => {
      const c = enhanceCost(sd);
      b.innerHTML = sd.enh >= ENHANCE_MAX ? '칸 강화 MAX' : `칸 강화 +${sd.enh + 1}<br><small>💰 ${fmt(c)} · ${g.s.equip[sl] ? pwr(ed) : '장비 없음'}</small>`;
      setDisabled(b, sd.enh >= ENHANCE_MAX || c > g.s.gold);
    });
    return b;
  }

  // 쿠폰 입력 (무제한 사용)
  couponCard(panel) {
    const g = this.game;
    const card = h('div', 'card coupon', `
      <div><b>🎟️ 쿠폰 입력</b> <span class="muted">· 같은 쿠폰을 몇 번이든 쓸 수 있습니다</span></div>
      <div class="couponrow"><input type="text" placeholder="쿠폰 번호 입력" maxlength="30"><button class="btn primary">사용</button></div>
      <div class="muted">사용 가능한 쿠폰: ${['에테르원정대', '큐브폭탄', '황금비', '보물사냥꾼', '물약상자'].map((c) => `<b class="ccode">${c}</b>`).join(' · ')} (영문: AETHER · CUBE · GOLD · TREASURE · POTION)</div>`);
    const input = $('input', card);
    const use = () => {
      const r = g.redeemCoupon(input.value);
      if (!r) { this.toast('없는 쿠폰입니다', 'bad'); return; }
      this.modal(`🎟️ ${r.name}`, `<div class="rewardlist">${r.lines.map((l) => `<div>${l}</div>`).join('')}</div>`, [{ label: '확인', cls: 'primary' }]);
    };
    $('button', card).addEventListener('click', use);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') use(); });
    card.querySelectorAll('.ccode').forEach((el) => el.addEventListener('click', () => { input.value = el.textContent; }));
    panel.appendChild(card);
  }

  // 자동 조합 온/오프
  autoCombineCard() {
    const g = this.game;
    const s = g.s;
    const on = !!s.settings.autoCombine;
    const card = h('div', 'card combinecard' + (on ? ' on' : ''), `
      <div><b>⚒️ 자동 조합 ${on ? 'ON' : 'OFF'}</b><div class="muted">같은 부위 · 같은 등급 3개가 모이면 바로 한 단계 위 등급으로 조합 (강화한 장비는 제외)</div></div>
      <button class="btn ${on ? '' : 'primary'} cbtn">${on ? '끄기' : '켜기'}</button>`);
    $('.cbtn', card).addEventListener('click', () => {
      g.toggleAutoCombine();
      this.toast(`자동 조합 ${s.settings.autoCombine ? '켜짐' : '꺼짐'}`, 'good');
      this.showTab('gear', true);
    });
    return card;
  }

  // 장비 조합 창: 같은 부위 · 같은 등급 3개 → 한 단계 높은 등급 1개
  gearCombine(panel) {
    const g = this.game;
    const s = g.s;
    panel.appendChild(h('div', 'muted pad', '가방에 있는 같은 부위 · 같은 등급 장비 3개를 합쳐 한 단계 높은 등급 장비 1개를 만듭니다. 셋 중 가장 좋은 장비의 종류 · 성향과 가장 높은 레벨 · 강화 수치를 이어받습니다. 장착 중인 장비는 쓰지 않습니다.'));
    const groups = g.combineGroups(false);
    const keys = Object.keys(groups).sort((a, b) => (+b.split('/')[1] - +a.split('/')[1]) || (groups[b].length - groups[a].length));
    const ready = keys.filter((k) => groups[k].length >= 3);
    const head = h('div', 'section-title', `조합 가능 ${ready.length}종`);
    const all = h('button', 'btn small primary', '모두 조합');
    setDisabled(all, !ready.length);
    all.addEventListener('click', () => {
      const n = g.combineAll(false);
      if (n) this.toast(`${n}번 조합했습니다`, 'good');
      this.showTab('gear', true);
    });
    head.appendChild(all);
    panel.appendChild(head);
    if (!keys.length) { panel.appendChild(h('div', 'muted center pad', '가방이 비어 있습니다')); return; }
    for (const k of keys) {
      const list = groups[k];
      const [slot, r] = [k.split('/')[0], +k.split('/')[1]];
      const n = list.length;
      const row = h('div', 'row bankrow', `
        <div class="ricon">${SLOTS[slot].icon}</div>
        <div class="rinfo"><div class="rtitle"><span class="rname"><span style="color:${RARITIES[r].color}">${RARITIES[r].name}</span> ${isRingSlot(slot) ? '반지' : SLOTS[slot].name}</span><span class="rlv">${n} / 3</span></div>
          <div class="rdesc">→ <span style="color:${RARITIES[r + 1].color}">${RARITIES[r + 1].name}</span> 1개${n >= 3 ? ` (${Math.floor(n / 3)}번 가능)` : ` · ${3 - n}개 더 필요`} · ${list.map((x) => itemName(x)).slice(0, 3).join(', ')}${n > 3 ? ' 외' : ''}</div></div>
        <div class="bbtns"><button class="btn small primary">조합</button></div>`);
      const b = $('button', row);
      setDisabled(b, n < 3);
      b.addEventListener('click', () => {
        const it = g.combineOne(k, false);
        if (it) this.toast(`조합: [${RARITIES[it.r].name}] ${itemName(it)}`, it.r >= 5 ? 'epic' : 'good');
        this.showTab('gear', true);
      });
      panel.appendChild(row);
    }
  }

  // ---------- 생활 스킬 ----------
  tabLife(panel) {
    const g = this.game;
    const s = g.s;
    const L = s.life;
    this.lifeDirty = false;
    this.lifeView = this.lifeView || 'skills';
    this.lifeSel = this.lifeSel || L.active?.skill || 'wood';

    // 진행 중인 행동 / 버프
    const act = h('div', 'card lifeact', `
      <div class="la-top"><span class="la-text"></span><button class="btn small la-stop">중지</button></div>
      <div class="lbar"><div></div></div>
      <div class="la-buffs muted"></div>`);
    panel.appendChild(act);
    const laText = $('.la-text', act);
    const laStop = $('.la-stop', act);
    const laBar = $('.lbar div', act);
    const laBuffs = $('.la-buffs', act);
    laStop.addEventListener('click', () => { stopAction(g); });
    this.updaters.push(() => {
      const a = L.active;
      if (a) {
        const k = LIFE[a.skill];
        const ad = k.actions.find((x) => x.id === a.action);
        setText(laText, L.stun > 0
          ? `🚨 들켰습니다! ${L.stun.toFixed(1)}초 기절 · ${ad.icon} ${ad.name}`
          : `${k.icon} ${k.name} · ${ad.icon} ${ad.name} (${actionTime(s, a.skill, ad).toFixed(1)}초)`);
        laBar.style.width = (L.progress * 100).toFixed(1) + '%';
        act.classList.toggle('stunned', L.stun > 0);
      } else {
        setText(laText, '쉬는 중 · 아래에서 행동을 골라 시작하세요');
        laBar.style.width = '0%';
      }
      laStop.style.visibility = a ? 'visible' : 'hidden';
      const bl = Object.entries(L.buffs).filter(([, t]) => t > 0).map(([b, t]) => `${BUFFS[b].name} ${BUFFS[b].label} ${fmtTime(t)}`);
      setText(laBuffs, bl.length ? '🧪 ' + bl.join(' · ') : '');
      laBuffs.style.display = bl.length ? '' : 'none';
    });

    const seg = h('div', 'buybar');
    for (const [v, label] of [['skills', '🛠️ 스킬'], ['bank', '📦 창고']]) {
      const b = h('button', this.lifeView === v ? 'on' : '', label);
      b.addEventListener('click', () => this.navTo(() => { this.lifeView = v; this.showTab('life'); }));
      seg.appendChild(b);
    }
    panel.appendChild(seg);

    if (this.lifeView === 'bank') this.lifeBank(panel);
    else this.lifeSkills(panel);
  }

  lifeSkills(panel) {
    const g = this.game;
    const s = g.s;
    const L = s.life;

    const grid = h('div', 'lifegrid');
    for (const k of LIFE_SKILLS) {
      const b = h('button', 'lchip' + (k.id === this.lifeSel ? ' sel' : ''), `<span class="lc-i">${k.icon}</span><span class="lc-n">${k.name}</span><span class="lc-l"></span>`);
      b.addEventListener('click', () => this.navTo(() => { this.lifeSel = k.id; this.showTab('life', true); }));
      grid.appendChild(b);
      const lv = $('.lc-l', b);
      this.updaters.push(() => {
        setText(lv, 'Lv ' + lifeLevel(s, k.id));
        b.classList.toggle('running', L.active?.skill === k.id);
      });
    }
    panel.appendChild(grid);
    const total = h('div', 'muted center');
    panel.appendChild(total);
    this.updaters.push(() => setText(total, `총 생활 레벨 ${LIFE_SKILLS.reduce((a, k) => a + lifeLevel(s, k.id), 0)} / ${LIFE_SKILLS.length * LIFE_MAX_LV}`));

    const k = LIFE[this.lifeSel];
    const head = h('div', 'card lifehead', `
      <div class="lh-top"><b>${k.icon} ${k.name}</b><span class="tag">${k.kind}</span><span class="lh-lv"></span></div>
      <div class="lbar xp"><div></div><span></span></div>
      <p>${k.desc}</p><p class="lh-bonus"></p>`);
    panel.appendChild(head);
    const hLv = $('.lh-lv', head);
    const hBar = $('.lbar div', head);
    const hTxt = $('.lbar span', head);
    const hBonus = $('.lh-bonus', head);
    this.updaters.push(() => {
      const lv = lifeLevel(s, k.id);
      const xp = L.xp[k.id] || 0;
      setText(hLv, `Lv ${lv} / ${LIFE_MAX_LV}`);
      if (lv >= LIFE_MAX_LV) {
        hBar.style.width = '100%';
        setText(hTxt, `최고 레벨 · 경험치 ${fmt(xp)}`);
      } else {
        const cur = xp - XP_TABLE[lv];
        const need = XP_TABLE[lv + 1] - XP_TABLE[lv];
        hBar.style.width = (cur / need * 100).toFixed(1) + '%';
        setText(hTxt, `${fmt(cur)} / ${fmt(need)} XP`);
      }
      let bonus;
      if (k.tool) bonus = `특수 효과: ${perkText(s, k.id)}`;
      else if (PRODUCTION.includes(k.id)) bonus = `작업대 속도 x${toolInfo(s, 'workshop').cur.speed}`;
      else if (k.id === 'divine') bonus = activePrayer(s) ? `기도 중: ${activePrayer(s).icon} ${activePrayer(s).name} (${activePrayer(s).desc})` : '켜 둔 기도가 없습니다 (아래에서 선택)';
      else bonus = '요구 레벨보다 높을수록 조금씩 빨라집니다 (최대 +25%)';
      const ls = LIFE_SPECIAL[k.id];
      if (ls) bonus += ` · ★ 레벨 특수 옵션: ${BONUS_NAMES[ls[0]]} +${pct(lifeSpecialOf(k.id, lv))} / +${pct(ls[1])} (Lv ${LIFE_MAX_LV})`;
      setText(hBonus, bonus);
    });

    // 채집 도구 / 가공 작업대
    const toolKey = k.tool || (PRODUCTION.includes(k.id) ? 'workshop' : null);
    if (toolKey) this.lifeToolCard(panel, toolKey);

    // 신성술: 기도 목록
    if (k.id === 'divine') this.lifePrayers(panel);

    for (const a of k.actions) {
      if (a.group) panel.appendChild(h('div', 'section-title', a.group));
      const r = makeRow(a.icon);
      setText(r.name, a.name);
      r.btn.addEventListener('click', () => {
        if (L.active?.skill === k.id && L.active.action === a.id) stopAction(g);
        else if (startAction(g, k.id, a.id)) this.toast(`${k.icon} ${a.name} 시작`, 'good');
      });
      panel.appendChild(r.el);
      this.updaters.push(() => {
        const lv = lifeLevel(s, k.id);
        const locked = lv < a.lvl;
        const running = L.active?.skill === k.id && L.active.action === a.id;
        const parts = [];
        if (a.in) parts.push('필요: ' + Object.entries(a.in).map(([id, n]) => `${MATS[id].icon}${MATS[id].name} ${n} (보유 ${fmt(L.bank[id] || 0)})`).join(', '));
        if (a.out) parts.push('획득: ' + Object.entries(a.out).map(([id, n]) => `${MATS[id].icon}${MATS[id].name} ${n} (보유 ${fmt(L.bank[id] || 0)})`).join(', '));
        if (a.equip) parts.push(`획득: ${a.equip.kinds ? a.equip.kinds.map((k) => WEAPONS[k].name).join('/') : a.equip.slots.map((x) => SLOTS[x].name).join('/')} · <span style="color:${RARITIES[a.equip.r].color}">${RARITIES[a.equip.r].name}</span> 이상 · ${materialOf(s.maxStage)} 단계`);
        if (a.gold) parts.push(`골드 약 ${fmt(a.gold * g.goldMult() * goldPerKillAt(s))}`);
        if (a.extra) parts.push('확률: ' + a.extra.map(([id, p]) => `${MATS[id].icon}${MATS[id].name} ${fmtPct(p, 1)} (보유 ${fmt(L.bank[id] || 0)})`).join(', '));
        const extra = [`XP ${fmt(actionXp(s, a))}`, `${actionTime(s, k.id, a).toFixed(1)}초 (x${speedMult(s, k.id, a).toFixed(2)})`];
        if (k.id === 'thief') extra.push(`성공 ${fmtPct(stealChance(s, a))}`);
        const bc = burnChance(s, k.id, a);
        if (bc > 0) extra.push(`태울 확률 ${fmtPct(bc)}`);
        parts.push(extra.join(' · '));
        const html = parts.join('<br>');
        if (r.desc._h !== html) { r.desc._h = html; r.desc.innerHTML = html; }
        setText(r.lv, `Lv ${a.lvl}`);
        r.el.classList.toggle('locked', locked);
        r.el.classList.toggle('running', running);
        const ok = hasInputs(s, a);
        setText(r.bt1, locked ? '🔒 잠김' : running ? '■ 중지' : '▶ 시작');
        setText(r.bt2, locked ? `Lv ${a.lvl} 필요` : !running && !ok ? '재료 부족' : '');
        setDisabled(r.btn, locked || (!running && !ok));
      });
    }
  }

  lifeToolCard(panel, key) {
    const g = this.game;
    const s = g.s;
    const t = TOOLS[key];
    const card = h('div', 'card toolcard', `
      <div class="tc-top"><span class="tc-name"></span><span class="tc-speed"></span></div>
      <div class="tc-next muted"></div>
      <button class="btn small primary tc-btn"></button>`);
    panel.appendChild(card);
    const nm = $('.tc-name', card);
    const sp = $('.tc-speed', card);
    const nx = $('.tc-next', card);
    const bt = $('.tc-btn', card);
    bt.addEventListener('click', () => {
      if (upgradeTool(g, key)) this.toast(`${t.icon} ${toolInfo(s, key).name}(으)로 업그레이드!`, 'epic');
    });
    this.updaters.push(() => {
      const info = toolInfo(s, key);
      setText(nm, `${t.icon} ${info.name}`);
      setText(sp, `속도 x${info.cur.speed}`);
      if (!info.next) {
        setText(nx, '최고 단계입니다');
        bt.style.display = 'none';
        return;
      }
      const mats = Object.entries(info.next.mats).map(([id, n]) => `${MATS[id].icon}${MATS[id].name} ${n} (보유 ${fmt(s.life.bank[id] || 0)})`);
      const req = [info.next.lvl ? `Lv ${info.next.lvl}` : null, info.next.gold ? `💰 ${fmt(info.next.gold)}` : null, ...mats].filter(Boolean);
      setText(nx, `다음: ${info.next.pre} ${t.name} (속도 x${info.next.speed}) · 필요: ${req.join(', ')}`);
      const chk = toolUpgradeCheck(s, key);
      setText(bt, chk.ok ? '업그레이드' : chk.why);
      setDisabled(bt, !chk.ok);
    });
  }

  lifePrayers(panel) {
    const s = this.game.s;
    panel.appendChild(h('div', 'section-title', '기도 (1개만 켤 수 있음)'));
    for (const p of PRAYERS) {
      const r = makeRow(p.icon);
      setText(r.name, p.name);
      setText(r.lv, `Lv ${p.lvl}`);
      setText(r.desc, p.desc);
      r.btn.addEventListener('click', () => {
        if (setPrayer(s, p.id)) this.toast(s.life.prayer ? `${p.icon} ${p.name} 시작` : '기도를 껐습니다', 'good');
      });
      panel.appendChild(r.el);
      this.updaters.push(() => {
        const locked = lifeLevel(s, 'divine') < p.lvl;
        const on = s.life.prayer === p.id && !locked;
        r.el.classList.toggle('locked', locked);
        r.el.classList.toggle('running', on);
        setText(r.bt1, locked ? '🔒 잠김' : on ? '■ 끄기' : '🙏 켜기');
        setText(r.bt2, locked ? `Lv ${p.lvl} 필요` : on ? '' : pwr(this.cached('pray' + p.id, () => this.game.powerDelta(() => { const o = s.life.prayer; s.life.prayer = p.id; return () => { s.life.prayer = o; }; }))));
        setDisabled(r.btn, locked);
      });
    }
  }

  lifeBank(panel) {
    const g = this.game;
    const s = g.s;
    const L = s.life;

    const opts = h('div', 'card opts', '<label class="toggle"><input type="checkbox"> 체력 40% 미만일 때 음식 자동 섭취</label>');
    const cb = $('input', opts);
    cb.checked = L.autoEat;
    cb.addEventListener('change', () => { L.autoEat = cb.checked; });
    panel.appendChild(opts);

    const owned = () => Object.keys(MATS).filter((id) => (L.bank[id] || 0) > 0);
    const ids = owned();
    const sig = ids.join(',');
    this.updaters.push(() => { if (owned().join(',') !== sig) this.lifeDirty = true; });
    panel.appendChild(h('div', 'section-title', `창고 (${ids.length}종)`));
    if (!ids.length) {
      panel.appendChild(h('div', 'muted center pad', '창고가 비어 있습니다. 생활 스킬로 재료를 모아 보세요.<br>몬스터를 잡으면 뼈도 얻습니다.'));
      return;
    }
    for (const id of ids) {
      const m = MATS[id];
      const row = h('div', 'row bankrow', `
        <div class="ricon">${m.icon}</div>
        <div class="rinfo"><div class="rtitle"><span class="rname">${m.name}</span><span class="rlv"></span></div><div class="rdesc"></div></div>
        <div class="bbtns"></div>`);
      const cnt = $('.rlv', row);
      const desc = $('.rdesc', row);
      const btns = $('.bbtns', row);
      let use = null;
      if (m.chest) {
        use = h('button', 'btn small primary', '모두 열기');
        use.addEventListener('click', () => {
          const lines = g.openChests(L.bank[id] || 0);
          if (lines) this.modal('🎁 보물 상자', `<div class="rewardlist">${lines.map((l) => `<div>${l}</div>`).join('')}</div>`, [{ label: '확인', cls: 'primary' }]);
          this.lifeDirty = true;
        });
        btns.appendChild(use);
      }
      if (m.buff) {
        use = h('button', 'btn small primary', '마시기');
        use.addEventListener('click', () => {
          if (usePotion(g, id)) this.toast(`${m.name}: ${m.buff.map((b) => BUFFS[b].name + ' ' + BUFFS[b].label).join(', ')}`, 'good');
        });
        btns.appendChild(use);
      }
      const sell = h('button', 'btn small', '전부 판매');
      sell.addEventListener('click', () => {
        const n = L.bank[id] || 0;
        const gold = sellMat(g, id, n);
        if (gold > 0) this.toast(`${m.name} ${fmt(n)}개 판매: 💰 ${fmt(gold)}`, 'good');
      });
      btns.appendChild(sell);
      panel.appendChild(row);
      const uses = matUses(id);
      const info = (m.heal ? `음식 · 체력 ${Math.round(m.heal * 100)}% 회복`
        : m.buff ? `물약 · ${m.buff.map((b) => BUFFS[b].name + ' ' + BUFFS[b].label).join(', ')} ${fmtTime(m.dur)}`
          : m.chest ? '열면 골드 · 보석 · 고유 전리품 · 장비' : m.unique ? '몬스터 고유 전리품' : m.meat ? '고기' : '재료')
        + (uses.length ? ` · 사용처: ${uses.join(', ')}` : '');
      this.updaters.push(() => {
        const n = L.bank[id] || 0;
        setText(cnt, 'x' + fmt(n));
        setText(desc, `${info} · 개당 💰 ${fmt(matValue(s, id))}`);
        if (use) setDisabled(use, n <= 0);
        setDisabled(sell, n <= 0);
      });
    }
  }

  // ---------- 지도 (몬스터 고르기) ----------
  openMap() {
    const g = this.game;
    const s = g.s;
    const zones = [];
    for (let z = 0; z <= s.maxZone + 1; z++) zones.push(z);
    const cur = s.target;
    const zoneHtml = (z) => {
      const locked = z > s.maxZone;
      const base = ZONES[z % ZONES.length];
      if (locked) {
        return `<div class="mapzone locked"><div class="mzhead"><span>🔒 ${zoneTitle(z)}</span><span class="muted">Lv ${monLevel(z, 0)}~${monLevel(z, BOSS_MI)}</span></div>
          <div class="muted mzlock">${zoneTitle(z - 1)}의 보스 ${ZONES[(z - 1) % ZONES.length].boss[0]} ${ZONES[(z - 1) % ZONES.length].boss[1]}를 처치하면 열립니다</div></div>`;
      }
      const rows = [0, 1, 2, 3, 4, BOSS_MI].map((mi) => {
        const info = monsterInfo(z, mi);
        const on = cur.z === z && cur.mi === mi;
        const d = MATS[info.drop];
        return `<button class="mrow${on ? ' on' : ''}${info.boss ? ' boss' : ''}" data-z="${z}" data-mi="${mi}">
          <span class="me">${info.e}</span>
          <span class="mn"><b>${info.boss ? '👑 ' : ''}${info.name}</b><small>Lv ${info.lvl} · 처치 ${fmt(g.killCount(z, mi))} · ${d.icon} ${d.name}</small></span>
          <span class="mgo">${on ? '사냥 중' : '선택'}</span></button>`;
      }).join('');
      return `<details class="mapzone" ${z === cur.z ? 'open' : ''}><summary class="mzhead"><span>${base.monsters[0][0]} ${zoneTitle(z)}</span><span class="muted">Lv ${monLevel(z, 0)}~${monLevel(z, BOSS_MI)}</span></summary>${rows}</details>`;
    };
    const body = `<p class="muted">몬스터를 고르면 그 몬스터만 계속 사냥합니다 (자동 진행 꺼짐). 지역 보스를 처음 잡으면 다음 지역이 열립니다.</p>
      <div class="maplist">${zones.map(zoneHtml).join('')}</div>`;
    const auto = s.settings.autoProgress;
    const box = this.modal('🗺️ 지도', body, [
      { label: auto ? '⏸ 자동 진행 끄기' : '▶ 자동 진행 켜기', cls: auto ? '' : 'primary', onClick: () => { g.toggleAutoProgress(); this.openMap(); return true; } },
      { label: '닫기' },
    ]);
    box.querySelectorAll('.mrow').forEach((b) => b.addEventListener('click', () => {
      g.selectTarget(+b.dataset.z, +b.dataset.mi);
      this.closeModal();
      if (this.tab === 'hero') this.showTab('hero', true);
    }));
  }

  // ---------- 박물관 ----------
  advMuseum(panel) {
    const g = this.game;
    const s = g.s;
    const tot = museumTotals(s);
    const sum = Object.keys(tot).length ? bonusText(tot) : '아직 없음';
    panel.appendChild(h('div', 'card note', `🏛️ 전시 레벨 합계 ${fmt(museumProgress(s))} / ${fmt(MUSEUM.length * MUSEUM_MAX)} · 지금 효과: ${sum}`));
    const amBox = h('label', 'toggle card', `<input type="checkbox" ${s.settings.autoMuseum ? 'checked' : ''}> 🏛️ 자동 기증 (고유 전리품을 얻는 대로 기증 · 제작 · 연금술 재료도 함께 쓰임)`);
    $('input', amBox).addEventListener('change', (ev) => { s.settings.autoMuseum = ev.target.checked; this.toast(ev.target.checked ? '🏛️ 박물관 자동 기증 켜짐' : '🏛️ 박물관 자동 기증 꺼짐'); });
    panel.appendChild(amBox);
    panel.appendChild(h('div', 'muted pad', `몬스터 고유 전리품을 기증해 전시 레벨을 올리세요 (종류마다 최대 Lv ${MUSEUM_MAX}). 레벨마다 효과가 조금씩 쌓이고, 다음 레벨일수록 더 많이 필요합니다. 한 지역 6종 중 가장 낮은 레벨이 그 지역의 세트 레벨이 되어 세트 효과도 레벨만큼 쌓입니다.`));
    this.museumOpen ||= { 0: true };
    ZONES.forEach((zone, z) => {
      const box = h('details', 'petgroup');
      box.open = !!this.museumOpen[z];
      box.addEventListener('toggle', () => { this.museumOpen[z] = box.open; });
      const list = MUSEUM.filter((e) => e.z === z);
      const sumEl = h('summary', '', '');
      box.appendChild(sumEl);
      const setLine = h('div', 'muted lnote', '');
      box.appendChild(setLine);
      for (const e of list) {
        const m = MATS[e.id];
        const info = monsterInfo(z, e.mi);
        const row = h('div', 'row bankrow museumrow', `
          <div class="ricon">${m.icon}</div>
          <div class="rinfo"><div class="rtitle"><span class="rname">${m.name}</span><span class="rlv"></span></div>
            <div class="rdesc"></div><div class="lbar"><div></div></div></div>
          <div class="bbtns"><button class="btn small primary">+1 Lv</button><button class="btn small">전부</button></div>`);
        const cnt = $('.rlv', row);
        const desc = $('.rdesc', row);
        const bar = $('.lbar div', row);
        const [b1, b2] = row.querySelectorAll('button');
        const go = (mode) => { const n = donate(g, e.id, mode); if (n > 0) { this.toast(`${m.name} ${fmt(n)}개 기증`, 'good'); this.advDirty = true; } };
        const md = museumDelta(g, e.id);
        b1.innerHTML = `+1 Lv<br><small>${pwr(md)}</small>`;
        b1.addEventListener('click', () => go('next'));
        b2.addEventListener('click', () => go('all'));
        box.appendChild(row);
        this.updaters.push(() => {
          const L = museumLevel(s, e);
          const nx = museumNext(s, e);
          const have = s.life.bank[e.id] || 0;
          setText(cnt, `Lv ${L}${L >= MUSEUM_MAX ? ' (최대)' : ''}`);
          setText(desc, `${info.e} ${info.name} · 지금 ${L ? bonusText(museumScale(e.bonus, L)) : '효과 없음'} · 레벨당 ${bonusText(e.bonus)}`
            + (nx ? ` · 다음 레벨 ${fmt(nx.have)} / ${fmt(nx.need)} (보유 ${fmt(have)})` : ''));
          bar.style.width = (nx ? (nx.have / nx.need) * 100 : 100) + '%';
          setDisabled(b1, !nx || have <= 0);
          setDisabled(b2, !nx || have <= 0);
        });
      }
      this.updaters.push(() => {
        const L = zoneSetLevel(s, z);
        setText(sumEl, `${L ? '🏆' : zone.monsters[0][0]} ${zone.name} · 세트 Lv ${L} · 전시 합계 ${list.reduce((n, e) => n + museumLevel(s, e), 0)}`);
        setText(setLine, `세트 효과 (레벨당 ${bonusText(ZONE_SET_BONUS[z])}) · 지금 ${L ? bonusText(museumScale(ZONE_SET_BONUS[z], L)) : '없음'}`);
      });
      panel.appendChild(box);
    });
  }

  // ---------- 모험 (퀘스트 · 박물관 · 스킬 보스 · 펫 · 날씨) ----------
  tabAdv(panel) {
    const g = this.game;
    const s = g.s;
    const c = climate();
    const wcard = h('div', 'card weather', `
      <div class="wx-top"><span class="wx-icon">${c.weather.icon}</span><div><b>오늘 날씨: ${c.weather.name}</b><div class="muted">${bonusText(c.weather.bonus)}</div></div></div>
      <div class="wx-top"><span class="wx-icon">${c.season.icon}</span><div><b>이번 주 계절: ${c.season.name}</b><div class="muted">${bonusText(c.season.bonus)}</div></div></div>
      <div class="muted wx-next"></div>`);
    panel.appendChild(wcard);
    const wn = $('.wx-next', wcard);
    this.updaters.push(() => setText(wn, `날씨는 매일 0시, 계절은 매주 월요일에 바뀝니다 · 날씨 변경까지 ${fmtTime(msToNextDay() / 1000)}`));

    const seg = h('div', 'buybar');
    for (const [v, label] of [['quest', '📜 퀘스트'], ['museum', '🏛️ 박물관'], ['sboss', '🐉 스킬 보스'], ['pet', '🐾 펫']]) {
      const b = h('button', this.advView === v ? 'on' : '', label);
      b.addEventListener('click', () => this.navTo(() => { this.advView = v; this.showTab('adv'); }));
      seg.appendChild(b);
    }
    panel.appendChild(seg);
    if (this.advView === 'sboss') this.advBoss(panel);
    else if (this.advView === 'pet') this.advPets(panel);
    else if (this.advView === 'museum') this.advMuseum(panel);
    else this.advQuests(panel);
  }

  rewardToast(title, lines) {
    if (!lines) return;
    this.modal(title, `<div class="rewardlist">${lines.map((l) => `<div>${l}</div>`).join('')}</div>`, [{ label: '확인', cls: 'primary' }]);
    this.showTab('adv', true);
  }

  questRow(panel, q, onClaim) {
    const r = makeRow(questIcon(q));
    setText(r.name, questText(q));
    r.btn.addEventListener('click', onClaim);
    panel.appendChild(r.el);
    const bar = h('div', 'lbar qbar', '<div></div>');
    $('.rinfo', r.el).appendChild(bar);
    const fill = $('div', bar);
    this.updaters.push(() => {
      const done = q.n >= q.goal;
      setText(r.desc, `${fmt(q.n)} / ${fmt(q.goal)}`);
      fill.style.width = Math.min(100, (q.n / q.goal) * 100).toFixed(1) + '%';
      r.el.classList.toggle('running', done && !q.claimed);
      r.el.classList.toggle('locked', q.claimed);
      setText(r.bt1, q.claimed ? '✔ 완료' : done ? '🎁 받기' : '진행 중');
      setText(r.bt2, '');
      setDisabled(r.btn, q.claimed || !done);
    });
  }

  advQuests(panel) {
    const g = this.game;
    const s = g.s;
    const Q = s.world.quests;

    // 원정 퀘스트
    panel.appendChild(h('div', 'section-title', `🗺️ 원정 퀘스트 (${Math.min(Q.chain, CHAIN.length)} / ${CHAIN.length})`));
    const cp = chainProgress(s);
    if (!cp) panel.appendChild(h('div', 'card muted center', '모든 원정 퀘스트를 완료했습니다!'));
    else {
      const rw = cp.reward;
      const r = makeRow('🗺️');
      setText(r.name, `${Q.chain + 1}. ${cp.text}`);
      setText(r.lv, `보상: ${RARITIES[rw.floor].name} 이상 장비${rw.pet ? ' · 펫 ' + PET[rw.pet].icon + PET[rw.pet].name : ''}`);
      r.lv.style.color = RARITIES[rw.floor].color;
      r.btn.addEventListener('click', () => this.rewardToast('🗺️ 원정 퀘스트 완료!', claimChain(g)));
      panel.appendChild(r.el);
      const bar = h('div', 'lbar qbar', '<div></div>');
      $('.rinfo', r.el).appendChild(bar);
      const fill = $('div', bar);
      this.updaters.push(() => {
        const p = chainProgress(s);
        if (!p) return;
        setText(r.desc, `${fmt(p.n)} / ${fmt(p.goal)}`);
        fill.style.width = Math.min(100, (p.n / p.goal) * 100).toFixed(1) + '%';
        r.el.classList.toggle('running', p.done);
        setText(r.bt1, p.done ? '🎁 받기' : '진행 중');
        setText(r.bt2, '');
        setDisabled(r.btn, !p.done);
      });
    }

    const dr = questReward(s, false);
    const dt = h('div', 'section-title', '📅 일일 퀘스트');
    panel.appendChild(dt);
    panel.appendChild(h('div', 'muted qnote', `보상: 💰 ${fmt(dr.gold)} + <span style="color:${RARITIES[dr.floor].color}">${RARITIES[dr.floor].name}</span> 이상 장비`));
    Q.daily.forEach((q, i) => this.questRow(panel, q, () => this.rewardToast('📅 일일 퀘스트 완료!', claimQuest(g, false, i))));
    const dn = h('div', 'muted center');
    panel.appendChild(dn);
    this.updaters.push(() => setText(dn, `새 일일 퀘스트까지 ${fmtTime(msToNextDay() / 1000)}`));

    const wr = questReward(s, true);
    panel.appendChild(h('div', 'section-title', '🗓️ 주간 퀘스트'));
    panel.appendChild(h('div', 'muted qnote', `보상: 💰 ${fmt(wr.gold)} + <span style="color:${RARITIES[wr.floor].color}">${RARITIES[wr.floor].name}</span> 이상 장비`));
    Q.weekly.forEach((q, i) => this.questRow(panel, q, () => this.rewardToast('🗓️ 주간 퀘스트 완료!', claimQuest(g, true, i))));
    const wn = h('div', 'muted center');
    panel.appendChild(wn);
    this.updaters.push(() => setText(wn, `새 주간 퀘스트까지 ${fmtTime(msToNextWeek() / 1000)}`));

    // 날짜가 바뀌면 다시 그림
    const sig = `${Q.day}/${Q.week}`;
    this.updaters.push(() => { if (`${Q.day}/${Q.week}` !== sig) this.advDirty = true; });
  }

  advBoss(panel) {
    const g = this.game;
    const s = g.s;
    panel.appendChild(h('div', 'card help', `<ul>
      <li>매주 보스마다 <b>${SB.tries}번</b> 도전할 수 있습니다 (월요일 0시 초기화).</li>
      <li>피해량은 해당 생활 스킬 레벨과 도구 성능, 채집 속도 효과로 정해집니다.</li>
      <li>누적 피해가 단계를 넘을 때마다 상자를 엽니다: 재료 · 골드 · 등급 하한 장비 · 드물게 <b>펫</b>.</li>
    </ul>`));
    for (const b of SKILL_BOSSES) {
      const card = h('div', 'card sboss', `
        <div class="sb-top"><span class="sb-icon">${b.icon}</span><div class="sb-info"><b>${b.name}</b> <span class="tag">${LIFE[b.skill].icon} ${LIFE[b.skill].name}</span><div class="muted">${b.desc}</div></div></div>
        <div class="lbar sb-hp"><div></div><span></span></div>
        <div class="sb-ms"></div>
        <div class="sb-foot"><span class="muted sb-dmg"></span><button class="btn primary sb-btn"></button></div>`);
      panel.appendChild(card);
      const fill = $('.sb-hp div', card);
      const txt = $('.sb-hp span', card);
      const ms = $('.sb-ms', card);
      const dmg = $('.sb-dmg', card);
      const btn = $('.sb-btn', card);
      btn.addEventListener('click', () => {
        const r = attackSkillBoss(g, b.id);
        if (!r) return;
        const body = `<p>${b.icon} ${b.name}에게 <b>${fmt(r.dmg)}</b> 피해!${r.killed ? ' <b>이번 주 처치 완료!</b>' : ''}</p>` +
          (r.chests.length ? r.chests.map((c) => `<div class="offlife"><b>🎁 ${c.name}</b>${c.lines.map((l) => `<div>${l}</div>`).join('')}</div>`).join('') : '<p class="muted">다음 상자까지 조금 더!</p>');
        this.modal('🐉 스킬 보스 도전', body, [{ label: '확인', cls: 'primary' }]);
        this.showTab('adv', true);
      });
      this.updaters.push(() => {
        const st = sbState(s, b.id);
        const p = st.dmg / SB.hp;
        fill.style.width = Math.max(0, 100 - p * 100).toFixed(2) + '%';
        setText(txt, `체력 ${fmt(SB.hp - st.dmg)} / ${fmt(SB.hp)} · 남은 도전 ${SB.tries - st.tries}회`);
        const html = SB.milestones.map((m, i) => `<span class="${i < st.got ? 'got' : ''}">${i < st.got ? '✔' : '🎁'} ${CHEST_NAMES[i]} ${Math.round(m * 100)}%</span>`).join('');
        if (ms._h !== html) { ms._h = html; ms.innerHTML = html; }
        setText(dmg, `예상 피해 약 ${fmt(sbDamage(s, b))} · 펫 ${PET[b.pet].icon}${PET[b.pet].name}${hasPet(s, b.pet) ? ' ✔' : ''}`);
        const chk = sbCheck(s, b);
        setText(btn, chk.ok ? '⚔️ 도전' : chk.why);
        setDisabled(btn, !chk.ok);
      });
    }
    const n = h('div', 'muted center');
    panel.appendChild(n);
    this.updaters.push(() => setText(n, `초기화까지 ${fmtTime(msToNextWeek() / 1000)}`));
  }

  advPets(panel) {
    const g = this.game;
    const s = g.s;
    const ap = activePet(s);
    this.petCard(panel, ap);
    panel.appendChild(h('div', 'muted center', `펫 도감 ${s.world.pets.owned.length} / ${PETS.length} · 드롭으로 얻는 펫은 드롭률 효과를 받습니다`));
    this.petOpen ||= { shop: true };
    for (const src of Object.keys(PET_SRC)) {
      const list = PETS.filter((p) => p.src === src);
      const box = h('details', 'petgroup');
      box.open = !!this.petOpen[src];
      box.addEventListener('toggle', () => { this.petOpen[src] = box.open; });
      box.appendChild(h('summary', 'section-title', `${PET_SRC[src]} (${list.filter((p) => hasPet(s, p.id)).length} / ${list.length})`));
      panel.appendChild(box);
      for (const p of list) {
        const owned = hasPet(s, p.id);
        const r = makeRow(owned || src === 'shop' ? p.icon : '❔');
        setText(r.name, owned || src === 'shop' ? p.name : '???');
        const pd = hasPet(s, p.id) ? g.petData(p.id) : null;
        r.desc.innerHTML = pd ? `+${pd.enh} · ${pd.pot ? `<span style="color:${POT_TIERS[pd.pot.t].color}">${POT_TIERS[pd.pot.t].name}</span> ${pd.pot.lines.map(([k, v]) => bonusText({ [k]: v })).join(' / ')}` : '잠재능력 없음'}` : '기본 수치 없음 · 강화와 잠재능력(5줄)으로 성장';
        const where = p.zone !== undefined ? ZONES_T[p.zone] : p.weather ? WEATHER_T[p.weather] : p.season ? SEASON_T[p.season] : p.skill ? LIFE[p.skill].icon + ' ' + LIFE[p.skill].name : '';
        if (where) setText(r.lv, where);
        r.btn.addEventListener('click', () => {
          if (hasPet(s, p.id)) { setPet(g, p.id); this.showTab('adv', true); }
          else if (buyPet(g, p.id)) this.showTab('adv', true);
        });
        box.appendChild(r.el);
        this.updaters.push(() => {
          const own = hasPet(s, p.id);
          const on = s.world.pets.active === p.id;
          r.el.classList.toggle('running', on);
          r.el.classList.toggle('locked', !own && src !== 'shop');
          if (own) {
            setText(r.bt1, on ? '■ 넣기' : '🐾 데리고 가기');
            setText(r.bt2, on ? '' : pwr(this.cached('pet' + p.id, () => g.powerDelta(() => { const P = s.world.pets; const a = P.active; P.active = p.id; return () => { P.active = a; }; }))));
            setDisabled(r.btn, false);
          } else if (src === 'shop') {
            const lockd = s.maxStage < p.stage;
            setText(r.bt1, lockd ? '🔒 잠김' : '구매');
            setText(r.bt2, lockd ? `Lv ${p.stage} 처치` : `💰 ${fmt(petCost(p))}`);
            setDisabled(r.btn, lockd || s.gold < petCost(p));
          } else {
            setText(r.bt1, '미획득');
            setText(r.bt2, '');
            setDisabled(r.btn, true);
          }
        });
      }
    }
  }

  // 잠깐 저장해 두는 계산 (전투력 미리보기처럼 무거운 값, 1.5초)
  cached(key, fn) {
    const now = performance.now();
    this.cache ||= {};
    const c = this.cache[key];
    if (c && now - c.t < 1500) return c.v;
    const v = fn();
    this.cache[key] = { t: now, v };
    return v;
  }

  // 데리고 다니는 펫: 골드 강화 · 잠재능력(5줄) 큐브
  petCard(panel, ap) {
    const g = this.game;
    const s = g.s;
    if (!ap) { panel.appendChild(h('div', 'card note', '데리고 다니는 펫이 없습니다. 펫은 1마리만 데리고 다닐 수 있습니다. 펫은 기본 수치가 없고, 💰 골드 강화와 🎲 잠재능력(5줄)으로 강해집니다.')); return; }
    const d = g.petData(ap.id);
    const card = h('div', 'card petcard', `
      <div class="cubehead"><span class="iicon">${ap.icon}</span><div><b>${ap.name}</b> <small>+${d.enh} / ${PET_ENH_MAX}</small>
        <div class="muted">${petEnhText(d)} · 강화 1회마다 ${bonusText(PET_ENH)}</div></div></div>
      <div class="potline">${d.pot ? `<span style="color:${POT_TIERS[d.pot.t].color}">◆ ${POT_TIERS[d.pot.t].name}</span> · ${d.pot.lines.map(([k, v]) => bonusText({ [k]: v })).join(' / ')}` : '잠재능력 없음 (큐브로 개방, 5줄 · ★ 특수 옵션 모든 피해)'}</div>
      <div class="cubebtns"></div>`);
    const btns = $('.cubebtns', card);
    const eb = h('button', 'btn primary');
    const ed = d.enh < PET_ENH_MAX ? g.petEnhDelta(ap.id) : 0;
    eb.addEventListener('click', () => { if (g.enhancePet(ap.id)) { this.toast(`${ap.icon} ${ap.name} +${d.enh} 강화!`, 'good'); this.showTab('adv', true); } });
    const cb = h('button', 'btn', '🎲 잠재능력 큐브');
    cb.addEventListener('click', () => this.openCube('pet:' + ap.id));
    btns.append(eb, cb);
    this.updaters.push(() => {
      const c = g.petEnhCost(ap.id);
      eb.innerHTML = d.enh >= PET_ENH_MAX ? '강화 MAX' : `💰 강화 +${d.enh + 1}<br><small>💰 ${fmt(c)} · ${pwr(ed)}</small>`;
      setDisabled(eb, d.enh >= PET_ENH_MAX || s.gold < c);
    });
    panel.appendChild(card);
  }

  tabMore(panel) {
    const g = this.game;
    const s = g.s;
    const st = h('div', 'card stats');
    // 안드로이드 앱 받기 (앱 안에서는 숨김)
    if (!window.Capacitor) {
      panel.appendChild(h('div', 'card note appcard', `📱 <b>안드로이드 앱</b> · <a class="btn small primary" href="https://github.com/7415794-alt/Realm-idle/releases/download/android-latest/aether-expedition.apk">APK 받기</a>
        <div class="muted">설치할 때 '출처를 알 수 없는 앱' 허용이 필요할 수 있습니다. 앱과 웹은 저장이 따로라, 진행을 옮기려면 아래 세이브 내보내기 · 불러오기를 쓰세요.</div>`));
    }
    this.couponCard(panel);
    panel.appendChild(h('div', 'section-title', '📊 통계'));
    panel.appendChild(st);
    const rows = [
      ['플레이 시간', () => fmtTime(s.stats.playTime)],
      ['총 처치', () => fmt(s.stats.kills)],
      ['보스 처치', () => fmt(s.stats.bossKills)],
      ['누적 골드', () => fmt(s.stats.goldEarned)],
      ['획득 장비', () => fmt(s.stats.items)],
      ['탭 횟수', () => fmt(s.stats.taps)],
      ['쓰러진 횟수', () => fmt(s.stats.deaths || 0)],
      ['최고 등급', () => RARITIES[s.stats.bestRarity || 0].name],
      ['역대 최고', () => `처치 Lv ${s.maxStage} · 지역 ${s.maxZone + 1}곳 개방`],
      ['박물관 전시 레벨', () => `${fmt(museumProgress(s))} / ${fmt(MUSEUM.length * MUSEUM_MAX)}`],
    ];
    const vals = rows.map(([label]) => {
      const it = h('div', 'stat', `<span>${label}</span><b></b>`);
      st.appendChild(it);
      return $('b', it);
    });
    this.updaters.push(() => rows.forEach(([, f], i) => setText(vals[i], f())));

    panel.appendChild(h('div', 'section-title', '👑 VIP'));
    panel.appendChild(h('div', 'card vipcard', `<b class="vip-text">${VIP.name}</b> <span class="tag">무료 적용 중</span>
      <p>생활 스킬 경험치 · 장비 드롭률 · 골드 획득 <b>${VIP.label}</b></p>
      <p class="muted">결제 없이 모든 플레이어에게 최고 등급 혜택이 적용됩니다.</p>`));

    panel.appendChild(h('div', 'section-title', '💾 저장'));
    const sv = h('div', 'card btngrid');
    const bSave = h('button', 'btn', '지금 저장');
    bSave.addEventListener('click', () => { this.hooks.onSave(); this.toast('저장되었습니다', 'good'); });
    const bExport = h('button', 'btn', '세이브 내보내기');
    bExport.addEventListener('click', () => {
      const code = exportState(s);
      this.modal('세이브 코드', `<p class="muted">이 코드를 복사해 다른 기기에서 불러올 수 있습니다.</p><textarea readonly class="code">${code}</textarea>`,
        [{ label: '복사', cls: 'primary', onClick: (box) => { navigator.clipboard?.writeText(code).then(() => this.toast('복사됨', 'good')).catch(() => { $('textarea', box).select(); }); return true; } }, { label: '닫기' }]);
    });
    const bImport = h('button', 'btn', '세이브 불러오기');
    bImport.addEventListener('click', () => {
      this.modal('세이브 불러오기', '<textarea class="code" placeholder="세이브 코드를 붙여넣으세요"></textarea>',
        [{ label: '취소' }, {
          label: '불러오기', cls: 'primary', onClick: (box) => {
            try {
              const st2 = importState($('textarea', box).value);
              this.hooks.onImport(st2);
              return false;
            } catch (e) {
              this.toast('잘못된 세이브 코드입니다', 'bad');
              return true;
            }
          },
        }]);
    });
    const bReset = h('button', 'btn danger', '데이터 초기화');
    bReset.addEventListener('click', () => {
      this.modal('정말 초기화할까요?', '<p>모든 진행 상황이 삭제되며 되돌릴 수 없습니다.</p>',
        [{ label: '취소' }, { label: '초기화', cls: 'danger', onClick: () => { clearState(); this.hooks.onReset(); } }]);
    });
    sv.append(bSave, bExport, bImport, bReset);
    panel.appendChild(sv);

    panel.appendChild(h('div', 'section-title', '❓ 도움말'));
    panel.appendChild(h('div', 'card help', `
      <ul>
        <li>전투 화면을 <b>탭</b>하면 영웅이 추가 공격합니다.</li>
        <li><b>🗺️ 지도</b>에서 사냥할 몬스터를 직접 고릅니다. 지역마다 일반 몬스터 5종(Lv +1 · 3 · 5 · 7 · 9)과 지역 보스(제한시간 ${BOSS_TIME}초)가 있고, 보스를 처음 잡으면 다음 지역이 열립니다.</li>
        <li><b>자동 진행</b>을 켜면 같은 몬스터를 ${AUTO_STREAK}마리 잡을 때마다 다음 몬스터 → 보스 → 다음 지역으로 나아가고, 지면 한 단계 물러나 재정비합니다.</li>
        <li>몬스터마다 <b>고유 전리품</b>이 있습니다. 🏛️ 박물관 기증(영구 효과) · 전리품 공예(특수 옵션 장비) · 연금술 · 비전술 · 신성술에 쓰이고, 고기는 요리, 🎁 보물 상자는 창고에서 엽니다.</li>
        <li>전투 방식(<b>근접 · 원거리 · 마법</b>)은 전투 화면 아래에서 직접 고릅니다. 모든 장비에 근접 · 원거리 · 마법 수치가 따로 붙어 있고, 고른 방식의 수치만 피해에 쓰입니다. 영웅 탭의 📊 스탯 분석에서 어떤 방식 · 스탯이 유리한지 볼 수 있습니다.</li>
        <li>장비 탭의 <b>🎲 큐브</b>로 장비(장착 여부 상관없음)의 잠재능력 3줄을 다시 굴립니다. 등급은 장비 등급과 같은 21단계, 같은 등급에서 천장 횟수를 채우면 다음 등급 확정. 부위마다 정해진 등급부터 특수 옵션이 나오고 같은 옵션이 겹칠 수 있습니다. 🔒로 원하는 줄을 잠글 수 있지만(최대 2줄) 큐브가 더 듭니다. ⏩ 자동 돌리기는 목표 등급 · 원하는 옵션이 나오면 멈춥니다.</li>
        <li>몬스터마다 <b>전리품 표</b>가 있고 각 항목을 따로 굴립니다. 드롭률 효과(VIP · 펫 · 날씨)는 모든 확률에 곱해집니다.</li>
        <li>영웅의 능력치는 <b>장비</b>로만 정해집니다. 장비는 12부위 · ${RARITIES.length}단계 등급이며, 골드로 강화(+${ENHANCE_MAX})할 수 있습니다.</li>
        <li>최대 피해 = 근접(또는 원거리) x 0.85 - 몬스터 방어 x 0.3 · 마법은 x 0.8 - 방어 x 0.22 · 방어가 높을수록 받는 피해가 줄어듭니다.</li>
        <li>막히면 약한 몬스터에서 장비와 전리품을 모으고 강화하거나, 대장기술·제작으로 장비를 만드세요.</li>
        <li><b>👑 VIP++</b>는 무료입니다: 생활 경험치 · 장비 드롭 · 골드 ${VIP.label}.</li>
        <li><b>🗺️ 모험</b> 탭: 일일·주간·원정 퀘스트, 주간 스킬 보스, 펫(1마리 동행), 매일 바뀌는 날씨와 매주 바뀌는 계절 효과.</li>
        <li><b>⛏️ 생활</b> 탭: 전투와 동시에 생활 스킬 1개를 진행합니다. 재료로 음식·물약·장비를 만듭니다.</li>
        <li>게임을 꺼도 최대 ${fmtTime(g.offlineCapSec())} 동안 골드·장비·뼈를 모으고 생활 스킬이 진행됩니다.</li>
      </ul>
      <p class="muted center">${GAME_NAME} v${VERSION}</p>`));
  }
}

const WICON = { sword: '🗡️', blade: '🗡️', great: '⚔️', xbow: '🏹', bow: '🏹', wand: '✨', staff: '🔮' };
// 장착 칸 배치 (몸 위치대로 3 x 4)
const DOLL = ['cape', 'helm', 'amulet', 'weapon', 'body', 'shield', 'gloves', 'legs', 'off', 'ring1', 'boots', 'ring2'];
const itemIcon = (it) => (it.slot === 'pet' ? PET[it.id.slice(4)]?.icon || '🐾' : it.slot === 'weapon' ? WICON[it.kind || 'sword'] : SLOTS[it.slot].icon);
// 전투력 변화 표시
const pwr = (d) => (Math.abs(d) < 0.05 ? '⚔ ±0' : `⚔ ${d > 0 ? '+' : '-'}${fmt(Math.abs(d))}`);
const pwrSpan = (d) => `<span class="diff ${d > 0.05 ? 'up' : d < -0.05 ? 'down' : ''}">${pwr(d)}</span>`;
const petEnhText = (d) => (d?.enh ? bonusText(Object.fromEntries(Object.entries(PET_ENH).map(([k, v]) => [k, v * d.enh]))) : '강화 없음');
const ZONES_T = ZONES.map((z) => z.name);
const WEATHER_T = Object.fromEntries(Object.entries(WEATHERS).map(([k, w]) => [k, w.icon + ' ' + w.name]));
const SEASON_T = Object.fromEntries(SEASONS.map((x) => [x.id, x.icon + ' ' + x.name]));

function goldPerKillAt(s) {
  return goldPerKill(Math.max(1, s.maxStage));
}

function lifeLines(log) {
  const lines = describeLog(log);
  return lines.length ? `<div class="offlife"><b>생활 스킬</b>${lines.map((l) => `<div>${l}</div>`).join('')}</div>` : '';
}

function matList(obj) {
  return Object.entries(obj).map(([id, n]) => `${MATS[id].icon} ${MATS[id].name} ${n}`).join(', ');
}

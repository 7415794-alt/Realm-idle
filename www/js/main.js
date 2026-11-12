// 진입점: 불러오기 → 게임 루프 → 자동 저장
import { Game } from './game.js';
import { Renderer } from './render.js';
import { UI } from './ui.js';
import { newState, loadState, saveState, clearState } from './state.js';

const AUTOSAVE_SEC = 15;
const OFFLINE_MIN_SEC = 60;   // 이 시간 이상 비우면 오프라인 보상 창 표시
const MAX_STEP = 0.1;         // 시뮬레이션 스텝 최대 크기
const MAX_SIM_SEC = 30;       // 이보다 긴 공백은 오프라인 계산으로 처리

let game;
let renderer;
let ui;
let frameCount = 0;
let last = 0;
let saveLocked = false;       // 초기화/불러오기 후 재시작할 때 이전 상태 저장 방지

function save() {
  if (game && !saveLocked) saveState(game.s);
}

function restartWith(state) {
  saveLocked = true;
  if (state) saveState(state);
  else clearState();
  location.reload();
}

function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > MAX_SIM_SEC) {
    // 탭이 백그라운드에 오래 있었던 경우
    const r = game.applyOffline(dt);
    if (dt >= OFFLINE_MIN_SEC) ui.showOffline(r);
    dt = 0;
  }
  const renderDt = Math.min(0.1, dt);
  let simDt = dt * game.speed(); // 배속 적용 (오프라인 보상은 실제 시간 기준)
  while (simDt > 0) {
    const step = Math.min(MAX_STEP, simDt);
    game.update(step);
    simDt -= step;
  }
  renderer.draw(renderDt);
  if (++frameCount % 6 === 0) ui.refresh();
  requestAnimationFrame(frame);
}

function init() {
  const state = loadState() || newState();
  game = new Game(state);
  window.game = game; // 콘솔 디버그용

  const canvas = document.getElementById('cv');
  renderer = new Renderer(canvas, game);
  canvas.addEventListener('pointerdown', (e) => {
    const r = canvas.getBoundingClientRect();
    game.tap();
    renderer.addRipple(e.clientX - r.left, e.clientY - r.top);
  });

  ui = window.ui = new UI(game, {
    onSave: save,
    onReset: () => restartWith(null),
    onImport: (st) => restartWith(st),
  });

  const away = (Date.now() - state.lastSeen) / 1000;
  if (away >= OFFLINE_MIN_SEC && state.stats.playTime > 0) ui.showOffline(game.applyOffline(away));

  setInterval(save, AUTOSAVE_SEC * 1000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  window.addEventListener('pagehide', save);
  window.addEventListener('beforeunload', save);

  requestAnimationFrame((t) => {
    last = t;
    requestAnimationFrame(frame);
  });

  // PWA 서비스 워커 (Capacitor 네이티브 앱에서는 사용하지 않음)
  if ('serviceWorker' in navigator && !window.Capacitor && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW 등록 실패', e));
  }
}

init();

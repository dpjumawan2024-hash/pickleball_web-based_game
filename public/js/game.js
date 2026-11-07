"use strict";
const C = document.getElementById("c"),
  X = C.getContext("2d");
const ST = document.getElementById("stage"),
  PR = document.getElementById("probe");
let W,
  H,
  S,
  OX,
  OY,
  SB = 0,
  DESKTOP = false;
const KB = matchMedia("(hover:hover) and (pointer:fine)").matches,
  LAND = matchMedia(
    "(orientation:landscape) and (pointer:coarse)",
  );
const settings = {
  displayName: "Player",
  leftHanded: false,
  haptics: true,
  lowQuality: false,
  masterVolume: 0.8,
  effectsVolume: 0.75,
};
try {
  Object.assign(settings, JSON.parse(localStorage.getItem("courtClashSettings") || "{}"));
} catch (_) {}
function cleanDisplayName(value) {
  return String(value || "").replace(/[<>\u0000-\u001f]/g, "").trim().slice(0, 8) || "Player";
}
settings.displayName = cleanDisplayName(settings.displayName);
async function requestMobileLandscape() {
  if (!matchMedia("(pointer: coarse)").matches) return;
  const notice = document.getElementById("orientationNotice");
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen)
      await document.documentElement.requestFullscreen();
    if (!screen.orientation?.lock) throw new Error("Screen orientation locking is unavailable.");
    await screen.orientation.lock("landscape");
    notice.classList.add("hide");
  } catch (_) {
    if (screen.orientation?.type.startsWith("landscape")) {
      notice.classList.add("hide");
      return;
    }
    notice.classList.remove("hide");
  }
}
document.addEventListener("click", (event) => {
  if (event.target.closest("#mobilePlay,#mobilePractice,#practiceNext,[data-mode],[data-d],#onlineOpen,#onlineConnect,#onlineCreate,#onlineJoin"))
    requestMobileLandscape();
});
document.getElementById("orientationNoticeClose").addEventListener("click", () => {
  document.getElementById("orientationNotice").classList.add("hide");
});
function rs() {
  const d = Math.min(window.devicePixelRatio || 1, settings.lowQuality ? 1 : 2);
  W = ST.clientWidth;
  H = ST.clientHeight;
  const desktopLayout = matchMedia(
    "(min-width:1000px) and (min-height:640px) and (hover:hover) and (pointer:fine)",
  ).matches;
  DESKTOP = desktopLayout || LAND.matches;
  C.width = W * d;
  C.height = H * d;
  X.setTransform(d, 0, 0, d, 0, 0);
  SB = parseFloat(getComputedStyle(PR).paddingBottom) || 0;
  if (LAND.matches) {
    S = Math.min((H - 24) / 20, (W - 32 - SB) / 46);
    OX = (H - 20 * S) / 2;
    OY = (W - 44 * S) / 2;
  } else if (desktopLayout) {
    S = Math.min((H - 86) / 20, (W - 170 - SB) / 46);
    OX = (H - 62 - 20 * S) / 2;
    OY = 80 + (W - 150 - SB - 44 * S) / 2;
  } else if (DESKTOP) {
    S = Math.min((H - 24) / 20, (W - 170 - SB) / 46);
    OX = (H - 20 * S) / 2;
    OY = 80 + (W - 150 - SB - 44 * S) / 2;
  } else {
    S = Math.min((W - 24) / 20, (H - 170 - SB) / 46);
    OX = (W - 20 * S) / 2;
    OY = 80 + (H - 150 - SB - 44 * S) / 2;
  }
}
addEventListener("resize", () => {
  rs();
  updateTouchControls();
});
addEventListener("orientationchange", () => {
  rs();
  updateTouchControls();
});
LAND.addEventListener("change", () => {
  rs();
  updateTouchControls();
});
if (window.ResizeObserver) new ResizeObserver(rs).observe(ST);
rs();
const px = (x) => OX + x * S,
  py = (y) => OY + y * S,
  clamp = (v, a, b) => Math.max(a, Math.min(b, v)),
  rnd = Math.random;
const screenX = (x, y) => (DESKTOP ? W - py(y) : px(x)),
  screenY = (x, y) => (DESKTOP ? px(x) : py(y));

/* ---------- audio (synth beeps, no files needed) ---------- */
let AC = null,
  muted = false;
function audio() {
  try {
    if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === "suspended") AC.resume();
  } catch (e) {}
}
function beep(f, d, type, v) {
  if (muted || !AC) return;
  const o = AC.createOscillator(),
    g = AC.createGain(),
    t = AC.currentTime;
  o.type = type || "square";
  o.frequency.value = f;
  g.gain.setValueAtTime((v || 0.07) * settings.masterVolume * settings.effectsVolume, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(g);
  g.connect(AC.destination);
  o.start(t);
  o.stop(t + d);
}
function paddlePop() {
  if (muted || !AC || settings.effectsVolume === 0 || settings.masterVolume === 0) return;
  const length = 0.055;
  const buffer = AC.createBuffer(1, Math.floor(AC.sampleRate * length), AC.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = (rnd() * 2 - 1) * (1 - i / samples.length);
  const source = AC.createBufferSource();
  const filter = AC.createBiquadFilter();
  const gain = AC.createGain();
  const now = AC.currentTime;
  source.buffer = buffer;
  filter.type = "bandpass";
  filter.frequency.value = 1050;
  filter.Q.value = 0.8;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.38 * settings.masterVolume * settings.effectsVolume, now + 0.003);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + length);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(AC.destination);
  source.start(now);
  source.stop(now + length);
}
function buzz(pattern) {
  if (settings.haptics && navigator.vibrate) navigator.vibrate(pattern);
}

/* ---------- game state ---------- */
let scoring = "rally"; // 'official' = side-out scoring (real pickleball), 'rally' = every rally scores
const WIN = 11; // points needed to win (must also lead by 2)
const GR = 32; // gravity in ft/s^2
const SKILL_HIT_BUFFER_MS = 4000;
const SKILL_COOLDOWNS = { drive: 8, drop: 10, curve: 8 };
const SKILL_LABELS = { drive: "Power Drive", drop: "Drop Shot", curve: "Topspin Curve" };
// spd = movement multiplier, reach = how far from you the paddle can hit (feet)
const CHARS = [
  {
    n: "Mango",
    d: "Balanced all-rounder",
    spd: 1,
    reach: 3.6,
    body: "#ff6b57",
    skin: "#ffe2c2",
    hair: "#5a3a22",
    hat: "cap",
    acc: "#ffffff",
    paddle: "#ff6b57",
  },
  {
    n: "Zippy",
    d: "Fastest, short reach",
    spd: 1.22,
    reach: 3.1,
    body: "#7c5cff",
    skin: "#c68642",
    hair: "#1c1c1c",
    hat: "band",
    acc: "#e8f24c",
    paddle: "#e8f24c",
  },
  {
    n: "Bruno",
    d: "Slow, huge reach",
    spd: 0.85,
    reach: 4.2,
    body: "#2e9b78",
    skin: "#8d5524",
    hair: "#111111",
    hat: "none",
    acc: "#fff",
    paddle: "#ff9f1c",
  },
  {
    n: "Luna",
    d: "Quick hands, medium reach",
    spd: 1.1,
    reach: 3.3,
    body: "#ff8fb8",
    skin: "#f1c27d",
    hair: "#3b2a6b",
    hat: "bun",
    acc: "#fff",
    paddle: "#4dd0e1",
  },
];
let sel = 0;
const DIFF = {
  easy: { spd: 7, err: 3.6, react: 0.4 },
  med: { spd: 8.2, err: 3.2, react: 0.32 },
  hard: { spd: 12.5, err: 1.1, react: 0.1 },
};
const DIFF_LABELS = { easy: "Easy", med: "Medium", hard: "Hard" };
let G = null,
  diffKey = "med",
  gameMode = "singles",
  ballTrail = [],
  hitFx = null,
  pointParticles = [],
  pendingSkillHit = null;
// side index: 0 = AI (top), 1 = you (bottom)
function newGame(k) {
  diffKey = k;
  pendingSkillHit = null;
  const doubles = gameMode === "doubles";
  G = {
    mode: gameMode,
    scoring: scoring,
    ch: CHARS[sel],
    aich: CHARS[
      (sel + 1 + Math.floor(rnd() * (CHARS.length - 1))) % CHARS.length
    ],
    mateCh: CHARS[(sel + 2) % CHARS.length],
    aiMateCh: CHARS[(sel + 3) % CHARS.length],
    d: DIFF[k],
    sc: [0, 0],
    srv: 1,
    st: "serve",
    t: 0,
    pl: { x: 15, y: 45.5, sw: 0 },
    mate: doubles ? { x: 5, y: 42, sw: 0, rt: 0, off: 0, mv: false } : null,
    ai: { x: 5, y: 3, sw: 0, rt: 0, off: 0, mv: false },
    aiMate: doubles ? { x: 15, y: 7, sw: 0, rt: 0, off: 0, mv: false } : null,
    b: { x: 15, y: 45.5, z: 2.5, vx: 0, vy: 0, vz: 0, curve: 0, curveTime: 0 },
    skillCooldowns: { drive: 0, drop: 0, curve: 0 },
    last: -1,
    lastActor: "",
    aiTarget: "ai",
    bn: 0,
    shots: 0,
    msg: "",
    sub: "",
    pt: 0,
    paused: false,
    over: false,
    aiT: 1,
    box: [0, 10],
  };
  startServe();
  updateTouchControls();
}
function startServe() {
  ballTrail = [];
  hitFx = null;
  const s = G.srv,
    ev = G.sc[s] % 2 === 0;
  const sx = ev ? (s === 1 ? 15 : 5) : s === 1 ? 5 : 15; // server x (right court first when score is even)
  const rx = 20 - sx;
  G.st = "serve";
  G.b.curve = 0;
  G.b.curveTime = 0;
  G.shots = 0;
  G.last = -1;
  G.bn = 0;
  G.msg = "";
  G.aiT = 1.1;
  G.box = sx > 10 ? [0, 10] : [10, 20]; // serve must land cross-court
  if (s === 1) {
    G.pl.x = sx;
    G.pl.y = 45.5;
    G.ai.x = rx;
    G.ai.y = 3;
    if (G.mate) {
      G.mate.x = rx;
      G.mate.y = 41;
      G.aiMate.x = sx;
      G.aiMate.y = 7;
    }
  } else {
    G.ai.x = sx;
    G.ai.y = -1;
    G.pl.x = rx;
    G.pl.y = 41;
    if (G.mate) {
      G.mate.x = sx;
      G.mate.y = 45.5;
      G.aiMate.x = rx;
      G.aiMate.y = 7;
    }
  }
}
function hit(who, tx, ty, Tmin, actorId, skill) {
  const b = G.b;
  tx = clamp(tx, -1, 21);
  ty = clamp(ty, -1, 45);
  const canUseSkill = who === 1 && skill && G.skillCooldowns[skill] <= 0 &&
    (skill !== "drop" || G.st === "rally");
  if (canUseSkill) {
    if (skill === "drop") ty = 18;
    if (skill === "drive") {
      tx += (rnd() - 0.5) * 2.8;
      ty += (rnd() - 0.5) * 1.8;
    }
  }
  tx = clamp(tx, -0.5, 20.5);
  ty = clamp(ty, -0.5, 44.5);
  b.z = Math.max(b.z, 1.2);
  const d = Math.hypot(tx - b.x, ty - b.y),
    baseTime = clamp(d / 26, Tmin || 1, 1.5),
    T = canUseSkill && skill === "drive" ? Math.max(0.52, baseTime * 0.72) :
      canUseSkill && skill === "drop" ? Math.min(1.7, baseTime * 1.2) : baseTime;
  const curve = canUseSkill && skill === "curve"
    ? (Math.sign(tx - b.x) || (G.srv === 1 ? -1 : 1)) * 6
    : 0;
  if (curve) {
    const curveDuration = Math.min(0.65, T);
    const curveDrift = curve * (curveDuration * T - curveDuration * curveDuration / 2);
    tx = clamp(tx - curveDrift, 0.5, 19.5);
  }
  b.vx = (tx - b.x) / T;
  b.vy = (ty - b.y) / T;
  b.vz = ((GR * T * T) / 2 - b.z) / T;
  b.curve = curve;
  b.curveTime = b.curve ? 0.65 : 0;
  if (canUseSkill) {
    G.skillCooldowns[skill] = SKILL_COOLDOWNS[skill];
    pendingSkillHit = null;
  }
  G.last = who;
  G.lastActor = actorId || (who === 1 ? "player" : "ai");
  G.bn = 0;
  G.shots++;
  G.st = "rally";
  hitFx = { x: b.x, y: b.y, z: b.z, t: 0.2 };
  if (who === 1) {
    const defenders = G.aiMate
      ? [
          ["ai", G.ai],
          ["aiMate", G.aiMate],
        ]
      : [["ai", G.ai]];
    G.aiTarget = defenders.reduce(
      (best, [id, actor]) =>
        Math.hypot(actor.x - tx, actor.y - ty) <
        Math.hypot(best.actor.x - tx, best.actor.y - ty)
          ? { id, actor }
          : best,
      { id: defenders[0][0], actor: defenders[0][1] },
    ).id;
    defenders.forEach(([, actor]) => {
      actor.rt = G.d.react;
      actor.off = (rnd() - 0.5) * G.d.err * 2;
    });
    if (G.lastActor === "mate") G.mate.sw = 0.25;
    else G.pl.sw = 0.25;
  } else {
    if (G.mate) {
      G.mate.rt = G.d.react;
      G.mate.off = (rnd() - 0.5) * G.d.err * 2;
    }
    (G.lastActor === "aiMate" ? G.aiMate : G.ai).sw = 0.25;
  }
  paddlePop();
  if (who === 1) buzz(18);
}
function lose(who, m) {
  if (G.st !== "rally") return;
  const w = 1 - who;
  G.st = "point";
  G.pt = 1.7;
  G.wb = w;
  pointParticles = settings.lowQuality
    ? []
    : Array.from({ length: 20 }, () => ({
        x: W / 2 + (rnd() - 0.5) * 100,
        y: H / 2 - 30 + (rnd() - 0.5) * 30,
        vx: (rnd() - 0.5) * 150,
        vy: -40 - rnd() * 110,
        t: 0.9 + rnd() * 0.4,
      }));
  if (w === 1) buzz([24, 40, 32]);
  G.note = "";
  if (G.scoring === "rally") {
    G.sc[w]++;
    G.srv = w;
    G.sub =
      w === 1
        ? G.mode === "doubles"
          ? "Point for your team"
          : "Point for you"
        : "Point for AI";
    G.note =
      who === 1
        ? G.mode === "doubles"
          ? "Your team mistake: the AI team scores."
          : "Your mistake: the AI scores."
        : G.mode === "doubles"
          ? "AI team mistake: your team scores."
          : "AI mistake: you score.";
  } else if (w === G.srv) {
    G.sc[w]++;
    G.sub =
      w === 1
        ? G.mode === "doubles"
          ? "Point for your team"
          : "Point for you"
        : "Point for AI";
  } else {
    G.srv = w;
    G.sub = w === 1 ? "Side out: you serve next" : "Side out: AI serves next";
    G.note = "No point. Only the server can score.";
  }
  G.msg =
    (who === 1
      ? G.mode === "doubles"
        ? "Your team fault: "
        : "Your fault: "
      : "AI fault: ") + m;
  if (w === 1) {
    beep(520, 0.1, "triangle", 0.1);
    setTimeout(() => beep(780, 0.14, "triangle", 0.1), 110);
  } else beep(180, 0.25, "sawtooth", 0.06);
  const a = G.sc[0],
    b = G.sc[1];
  if (Math.max(a, b) >= WIN && Math.abs(a - b) >= 2) {
    G.over = true;
    showMsg(
      b > a
        ? G.mode === "doubles"
          ? "Your team wins!"
          : "You win!"
        : "AI wins",
      `Final score: ${G.mode === "doubles" ? "your team" : "you"} ${b} – AI ${a}`,
      "Play again",
      () => newGame(diffKey),
      false,
      `AI difficulty: ${DIFF_LABELS[diffKey]}`,
    );
  }
}
function landed() {
  const b = G.b,
    s = b.y < 22 ? 0 : 1,
    LR = 0.5; // LR: a ball touching a line is in (ball radius)
  beep(300, 0.05, "sine", 0.12);
  // Second bounce: the first bounce was already judged in, so the receiver failed to return it.
  if (G.bn >= 1) {
    lose(1 - G.last, "Double bounce");
    return;
  }
  if (b.x < -LR || b.x > 20 + LR || b.y < -LR || b.y > 44 + LR) {
    lose(G.last, "Ball was out");
    return;
  }
  if (G.shots === 1) {
    if (
      s !== 1 - G.srv ||
      b.x < G.box[0] - LR ||
      b.x > G.box[1] + LR ||
      Math.abs(b.y - 22) <= 7 + LR
    ) {
      lose(G.srv, "Serve fault");
      return;
    }
  }
  if (s === G.last) {
    lose(G.last, "Ball stayed on own side");
    return;
  }
  G.bn++;
}

/* ---------- player actions ---------- */
function pSwing(dx, dy, skill = null) {
  if (window.OnlineGame && window.OnlineGame.active) {
    window.OnlineGame.hit(dx / Math.max(W * 0.28, 1), dy / Math.max(H * 0.28, 1), skill);
    return true;
  }
  if (!G || G.paused || G.over || G.pl.sw > 0) return false;
  const p = G.pl,
    b = G.b,
    len = Math.hypot(dx, dy);
  if (G.st === "serve" && G.srv === 1) {
    const f = len < 24 ? 0.5 : clamp(len / (Math.min(W, H) * 0.3), 0, 1);
    const ax =
      len < 24
        ? (G.box[0] + G.box[1]) / 2
        : DESKTOP
          ? clamp(
              (G.box[0] + G.box[1]) / 2 + clamp(dy / (H * 0.28), -1, 1) * 4.2,
              G.box[0] + 0.8,
              G.box[1] - 0.8,
            )
          : 10 + clamp(dx / (W * 0.28), -1, 1) * 8.5;
    b.x = p.x;
    b.y = p.y;
    b.z = 2.5;
    const ty = DESKTOP
      ? clamp(14 - f * 11 - clamp(dx / (W * 0.28), -1, 1) * 2, 2, 14)
      : clamp(14 - f * 11, 2, 14);
    hit(1, clamp(ax, G.box[0] + 0.8, G.box[1] - 0.8), ty, 1.15, undefined, skill);
    return true;
  }
  p.sw = 0.2; // whiff animation even if no contact
  if (
    G.st !== "rally" ||
    (G.last === 1 && (!G.mate || G.lastActor !== "mate")) ||
    b.y < 22
  )
    return false;
  if (Math.hypot(p.x - b.x, p.y - b.y) > G.ch.reach || b.z > 5.5) return false;
  if (G.bn === 0) {
    if (G.shots < 3) {
      hit(1, 10, 10, 1);
      lose(1, "Hit before the bounce");
      return;
    }
    if (Math.abs(p.y - 22) <= 7) {
      hit(1, 10, 10, 1);
      lose(1, "Volley in kitchen");
      return;
    }
  }
  let tx, ty;
  if (len < 24) {
    tx = 10 + (b.x - p.x) * 1.5;
    ty = 18.5;
  } else if (DESKTOP) {
    const f = clamp(len / (Math.min(W, H) * 0.3), 0, 1);
    tx = 10 + clamp(dy / (H * 0.28), -1, 1) * 8.5 + (b.x - p.x) * 0.8;
    ty = 17 - f * 14 - clamp(dx / (W * 0.28), -1, 1) * 3;
  } else {
    const f = clamp(len / (H * 0.3), 0, 1);
    tx = 10 + clamp(dx / (W * 0.28), -1, 1) * 8.5 + (b.x - p.x) * 0.8;
    ty = 17 - f * 14;
  }
  hit(1, clamp(tx, 0.5, 19.5), Math.max(ty, 1), 1, undefined, skill);
  return true;
}

/* ---------- input ---------- */
const tp = {},
  keys = {};
const moveStick = document.getElementById("moveStick"),
  stickNub = document.getElementById("stickNub"),
  stick = { x: 0, y: 0 };
let stickPointer = null;
function moveStickTo(e) {
  const r = moveStick.getBoundingClientRect(),
    radius = (r.width - stickNub.offsetWidth) / 2;
  let x = (e.clientX - r.left - r.width / 2) / radius,
    y = (e.clientY - r.top - r.height / 2) / radius,
    m = Math.hypot(x, y);
  if (m > 1) {
    x /= m;
    y /= m;
  }
  stick.x = x;
  stick.y = y;
  stickNub.style.setProperty("--stick-x", `${x * radius}px`);
  stickNub.style.setProperty("--stick-y", `${y * radius}px`);
}
function setOnlineMoveFromStick() {
  if (!window.OnlineGame?.active) return;
  window.OnlineGame.setMove(
    LAND.matches ? stick.y : stick.x,
    LAND.matches ? -stick.x : stick.y,
  );
}
function resetMoveStick() {
  stickPointer = null;
  stick.x = 0;
  stick.y = 0;
  moveStick.setAttribute("aria-pressed", "false");
  stickNub.style.setProperty("--stick-x", "0px");
  stickNub.style.setProperty("--stick-y", "0px");
}
moveStick.addEventListener("pointerdown", (e) => {
  if (window.OnlineGame && window.OnlineGame.active) {
    e.preventDefault();
    audio();
    stickPointer = e.pointerId;
    moveStick.setAttribute("aria-pressed", "true");
    try {
      moveStick.setPointerCapture(e.pointerId);
    } catch (_) {}
    moveStickTo(e);
    setOnlineMoveFromStick();
    return;
  }
  if (!G || G.paused || G.over) return;
  e.preventDefault();
  audio();
  stickPointer = e.pointerId;
  moveStick.setAttribute("aria-pressed", "true");
  try {
    moveStick.setPointerCapture(e.pointerId);
  } catch (_) {}
  moveStickTo(e);
});
moveStick.addEventListener("pointermove", (e) => {
  if (e.pointerId === stickPointer) {
    moveStickTo(e);
    if (window.OnlineGame && window.OnlineGame.active)
      setOnlineMoveFromStick();
  }
});
const releaseStick = (e) => {
  if (e.pointerId === stickPointer) {
    resetMoveStick();
    if (window.OnlineGame && window.OnlineGame.active)
      window.OnlineGame.setMove(0, 0);
  }
};
moveStick.addEventListener("pointerup", releaseStick);
moveStick.addEventListener("pointercancel", releaseStick);
moveStick.addEventListener("lostpointercapture", releaseStick);
const hitTouch = document.getElementById("hitTouch");
let hitPointer = null;
hitTouch.addEventListener("pointerdown", (e) => {
  if (
    !(window.OnlineGame && window.OnlineGame.active) &&
    (!G || G.paused || G.over)
  )
    return;
  e.preventDefault();
  audio();
  hitPointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
  try {
    hitTouch.setPointerCapture(e.pointerId);
  } catch (_) {}
});
const releaseHitTouch = (e, fire) => {
  if (!hitPointer || e.pointerId !== hitPointer.id) return;
  const dx = e.clientX - hitPointer.x;
  const dy = e.clientY - hitPointer.y;
  hitPointer = null;
  if (!fire) return;
  if (Math.hypot(dx, dy) >= 24) {
    pSwing(dx, dy);
    return;
  }
  const neutral = Math.hypot(stick.x, stick.y) < 0.15;
  pSwing(stick.x * W * 0.28, neutral ? -H * 0.18 : stick.y * H * 0.28);
};
hitTouch.addEventListener("pointerup", (e) => releaseHitTouch(e, true));
hitTouch.addEventListener("pointercancel", (e) => releaseHitTouch(e, false));
hitTouch.addEventListener("lostpointercapture", (e) => releaseHitTouch(e, false));
C.addEventListener("pointerdown", (e) => {
  if (!G || G.paused || G.over) return;
  audio();
  const R = C.getBoundingClientRect(),
    lx = e.clientX - R.left,
    ly = e.clientY - R.top;
  const moveSide = settings.leftHanded ? lx >= W / 2 : lx < W / 2;
  tp[e.pointerId] = { x0: lx, y0: ly, x: lx, y: ly, m: moveSide };
  try {
    C.setPointerCapture(e.pointerId);
  } catch (_) {}
});
C.addEventListener("pointermove", (e) => {
  const t = tp[e.pointerId];
  if (t) {
    const R = C.getBoundingClientRect();
    t.x = e.clientX - R.left;
    t.y = e.clientY - R.top;
  }
});
const up = (e, sw) => {
  const t = tp[e.pointerId];
  if (t && !t.m && sw) pSwing(t.x - t.x0, t.y - t.y0);
  delete tp[e.pointerId];
};
C.addEventListener("pointerup", (e) => up(e, true));
C.addEventListener("pointercancel", (e) => up(e, false));
addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();
  if (!e.repeat && (key === "q" || key === "e" || key === "r")) {
    if ((G && !G.paused && !G.over) || window.OnlineGame?.active) {
      e.preventDefault();
      executeSkill({ q: "drive", e: "drop", r: "curve" }[key]);
    }
  }
  keys[key] = 1;
  if (e.code === "Space") {
    e.preventDefault();
    audio();
    const dx = (keys["arrowright"] ? 1 : 0) - (keys["arrowleft"] ? 1 : 0);
    pSwing(dx * H * 0.15, keys["x"] ? 0 : -H * (keys["shift"] ? 0.3 : 0.18));
  }
  if (e.key === "Escape" || e.key === "p") pause();
});
addEventListener("keyup", (e) => {
  delete keys[e.key.toLowerCase()];
});
document.querySelectorAll(".skill-button").forEach((button) => {
  button.addEventListener("click", () => executeSkill(button.dataset.skill));
});

/* ---------- update ---------- */
function landingTarget() {
  const b = G.b;
  if (G.bn > 0) return { x: b.x, y: b.y };
  const t =
    (b.vz + Math.sqrt(Math.max(0, b.vz * b.vz + 2 * GR * Math.max(b.z, 0)))) /
    GR;
  return { x: b.x + b.vx * t, y: b.y + b.vy * t };
}
function moveActor(actor, tx, ty, speed, dt) {
  const dx = tx - actor.x,
    dy = ty - actor.y,
    l = Math.hypot(dx, dy),
    step = speed * dt;
  if (l > step && l > 0) {
    actor.x += (dx / l) * step;
    actor.y += (dy / l) * step;
  } else {
    actor.x = tx;
    actor.y = ty;
  }
}
function upd(dt) {
  const actors = [G.pl, G.ai, G.mate, G.aiMate].filter(Boolean),
    before = actors.map((actor) => ({ x: actor.x, y: actor.y }));
  upd0(dt);
  if (pendingSkillHit && !pendingSkillHit.online) {
    if (performance.now() >= pendingSkillHit.expiresAt || G.paused || G.over) {
      pendingSkillHit = null;
    } else if (canPlayerSkillHit(pendingSkillHit.skill)) {
      const applied = pSwing(pendingSkillHit.dx, pendingSkillHit.dy, pendingSkillHit.skill);
      if (applied) {
        pendingSkillHit = null;
      }
    }
  }
  actors.forEach((actor, i) => {
    actor.mv =
      dt > 0 &&
      Math.hypot(actor.x - before[i].x, actor.y - before[i].y) / dt > 1.5;
  });
}
function canPlayerSkillHit(skill) {
  if (!G || G.paused || G.over || G.pl.sw > 0) return false;
  if (G.st === "serve") return G.srv === 1;
  if (G.st !== "rally" || (G.last === 1 && (!G.mate || G.lastActor !== "mate")) || G.b.y < 22) return false;
  if (Math.hypot(G.pl.x - G.b.x, G.pl.y - G.b.y) > G.ch.reach || G.b.z > 5.5) return false;
  if (G.bn === 0 && (G.shots < 3 || Math.abs(G.pl.y - 22) <= 7)) return false;
  return skill !== "drop" || G.st === "rally";
}
function upd0(dt) {
  G.t += dt;
  Object.keys(G.skillCooldowns).forEach((skill) => {
    G.skillCooldowns[skill] = Math.max(0, G.skillCooldowns[skill] - dt);
  });
  if (hitFx) {
    hitFx.t -= dt;
    if (hitFx.t <= 0) hitFx = null;
  }
  pointParticles.forEach((particle) => {
    particle.t -= dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vy += 220 * dt;
  });
  pointParticles = pointParticles.filter((particle) => particle.t > 0);
  const p = G.pl,
    b = G.b,
    d = G.d,
    opponents = G.aiMate
      ? [
          { id: "ai", actor: G.ai },
          { id: "aiMate", actor: G.aiMate },
        ]
      : [{ id: "ai", actor: G.ai }];
  [p, G.ai, G.mate, G.aiMate].filter(Boolean).forEach((actor) => {
    actor.sw = Math.max(0, actor.sw - dt);
  });
  // human movement
  let vx = LAND.matches ? stick.y : stick.x,
    vy = LAND.matches ? -stick.x : stick.y;
  for (const k in tp) {
    const t = tp[k];
    if (t.m) {
      const ex = t.x - t.x0,
        ey = t.y - t.y0,
        l = Math.hypot(ex, ey);
      if (l > 4) {
        const m = Math.min(l, 55) / 55;
        vx = DESKTOP ? (ey / l) * m : (ex / l) * m;
        vy = DESKTOP ? (-ex / l) * m : (ey / l) * m;
      }
    }
  }
  if (DESKTOP) {
    vx += (keys["s"] ? 1 : 0) - (keys["w"] ? 1 : 0);
    vy += (keys["a"] ? 1 : 0) - (keys["d"] ? 1 : 0);
  } else {
    vx += (keys["d"] ? 1 : 0) - (keys["a"] ? 1 : 0);
    vy += (keys["s"] ? 1 : 0) - (keys["w"] ? 1 : 0);
  }
  if (!(G.st === "serve" && G.srv === 1)) {
    p.x = clamp(p.x + vx * 15 * G.ch.spd * dt, -2, 22);
    p.y = clamp(p.y + vy * 15 * G.ch.spd * dt, 23, 46.5);
  }
  if (G.st === "point") {
    G.pt -= dt;
    if (G.pt <= 0 && !G.over) startServe();
  }
  // AI serve
  if (G.st === "serve" && G.srv === 0) {
    G.aiT -= dt;
    if (G.aiT <= 0) {
      b.x = G.ai.x;
      b.y = G.ai.y;
      b.z = 2.5;
      const tx =
          G.box[0] +
          1 +
          rnd() * (G.box[1] - G.box[0] - 2) +
          (rnd() - 0.5) * d.err * 0.5,
        ty = 30 + rnd() * 10;
      hit(0, tx, ty, 1.15, "ai");
    }
  } else if (G.st === "rally") {
    if (G.last === 1) {
      const target = landingTarget(),
        chaser =
          opponents.find((entry) => entry.id === G.aiTarget) || opponents[0];
      if (G.mate) moveActor(G.mate, p.x < 10 ? 15 : 5, 39, d.spd * 0.65, dt);
      opponents.forEach(({ id, actor }) => {
        if (id === chaser.id) {
          actor.rt -= dt;
          if (actor.rt <= 0)
            moveActor(
              actor,
              target.x + actor.off,
              clamp(target.y, -2, 20.5),
              d.spd,
              dt,
            );
        } else moveActor(actor, 10 + (p.x - 10) * 0.3, 6, d.spd * 0.6, dt);
        actor.x = clamp(actor.x, -2, 22);
        actor.y = clamp(actor.y, -2, 21);
      });
      const defender = chaser.actor;
      if (
        b.y < 22 &&
        Math.hypot(defender.x - b.x, defender.y - b.y) < 3.2 &&
        b.z < 5 &&
        (G.bn >= 1 || (G.shots >= 3 && Math.abs(defender.y - 22) > 7))
      ) {
        const teamX = G.mate ? (p.x + G.mate.x) / 2 : p.x,
          r = rnd(),
          k = teamX < 10 ? 11 + rnd() * 8 : 1 + rnd() * 8,
          ty = r < 0.2 ? 26.5 : r < 0.8 ? 33 : 41;
        hit(
          0,
          k + (rnd() - 0.5) * d.err * 2,
          ty + (rnd() - 0.5) * d.err * 2,
          1,
          chaser.id,
        );
      }
    } else {
      const tx = 10 + (p.x - 10) * 0.3;
      opponents.forEach(({ actor }, i) =>
        moveActor(actor, tx + (i ? 2 : -2), i ? 8 : 5, d.spd * 0.6, dt),
      );
      if (G.mate && b.y >= 22) {
        const target = landingTarget(),
          mateDistance = Math.hypot(target.x - G.mate.x, target.y - G.mate.y),
          playerDistance = Math.hypot(target.x - p.x, target.y - p.y),
          mateCovers = mateDistance <= playerDistance + 1;
        G.mate.rt -= dt;
        if (mateCovers && G.mate.rt <= 0)
          moveActor(
            G.mate,
            target.x + G.mate.off,
            clamp(target.y, 24, 44),
            d.spd * 1.15,
            dt,
          );
        else if (!mateCovers)
          moveActor(G.mate, p.x < 10 ? 15 : 5, 39, d.spd * 0.65, dt);
        G.mate.x = clamp(G.mate.x, -2, 22);
        G.mate.y = clamp(G.mate.y, 23, 46.5);
        if (
          mateCovers &&
          Math.hypot(G.mate.x - b.x, G.mate.y - b.y) <
            Math.max(3.2, G.mateCh.reach) &&
          b.z < 5 &&
          (G.bn >= 1 || (G.shots >= 3 && Math.abs(G.mate.y - 22) > 7))
        ) {
          const r = rnd(),
            tx = clamp(10 + (b.x - G.mate.x) * 1.2, 0.5, 19.5),
            ty = r < 0.2 ? 12 : r < 0.8 ? 8 : 4;
          hit(1, tx, ty, 1.25, "mate");
        }
      } else if (G.mate)
        moveActor(G.mate, 10 + (p.x - 10) * 0.45, 33, d.spd * 0.55, dt);
    }
  }
  // ball
  if (G.st === "serve") {
    const server = G.srv ? p : G.ai;
    b.x = server.x;
    b.y = server.y;
    b.z = 2.5;
    b.vx = b.vy = b.vz = 0;
  } else {
    const oy = b.y;
    if (b.curveTime > 0) {
      b.vx += b.curve * dt;
      b.curveTime = Math.max(0, b.curveTime - dt);
      if (b.curveTime === 0) b.curve = 0;
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.vz -= GR * dt;
    b.z += b.vz * dt;
    if ((oy - 22) * (b.y - 22) < 0 && b.z < 2 && G.st === "rally")
      lose(G.last, "Hit the net");
    if (b.z <= 0 && b.vz < 0) {
      b.z = 0;
      landed();
      b.vz = -b.vz * 0.7;
      b.vx *= 0.8;
      b.vy *= 0.8;
      b.curve = 0;
      b.curveTime = 0;
      if (b.vz < 3) {
        b.vz = 0;
        if (G.st === "rally") landed();
        b.vx *= 0.3;
        b.vy *= 0.3;
      }
    }
    if (b.z === 0 && b.vz === 0) {
      b.vx *= 0.96;
      b.vy *= 0.96;
    }
  }
  if (G.st === "rally") {
    ballTrail.push({ x: b.x, y: b.y, z: b.z });
    if (ballTrail.length > 9) ballTrail.shift();
  } else ballTrail = [];
}

/* ---------- drawing ---------- */
function rr(x, y, w, h, r) {
  X.beginPath();
  X.moveTo(x + r, y);
  X.arcTo(x + w, y, x + w, y + h, r);
  X.arcTo(x + w, y + h, x, y + h, r);
  X.arcTo(x, y + h, x, y, r);
  X.arcTo(x, y, x + w, y, r);
  X.closePath();
}
function rrc(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
// Full-body chibi character. cx,cy = feet position, s = size unit, dir = 1 (seen from behind) or -1 (facing us)
function drawChar(c, cx, cy, s, ch, sw, dir, mv, t) {
  const hs = dir,
    hr = 0.95 * s,
    hy = cy - 3.1 * s,
    st = mv ? Math.sin(t * 16) * 0.32 * s : 0,
    back = dir > 0;
  if (!settings.lowQuality) {
    c.fillStyle = "rgba(0,0,0,.34)";
    c.beginPath();
    c.ellipse(cx, cy + 0.1 * s, 1.15 * s, 0.34 * s, 0, 0, 7);
    c.fill();
  }
  c.lineCap = "round";
  c.lineJoin = "round";
  // Legs, socks, and court shoes
  c.fillStyle = ch.skin;
  rrc(c, cx - 0.69 * s, cy - 1.05 * s + st * 0.18, 0.46 * s, 0.9 * s - st * 0.18, 0.18 * s);
  c.fill();
  rrc(c, cx + 0.23 * s, cy - 1.05 * s - st * 0.18, 0.46 * s, 0.9 * s + st * 0.18, 0.18 * s);
  c.fill();
  c.fillStyle = "rgba(255,255,255,.82)";
  c.beginPath();
  c.ellipse(cx - 0.46 * s, cy - 0.2 * s + st * 0.18, 0.25 * s, 0.13 * s, 0, 0, 7);
  c.ellipse(cx + 0.46 * s, cy - 0.2 * s - st * 0.18, 0.25 * s, 0.13 * s, 0, 0, 7);
  c.fill();
  c.fillStyle = "#f4f7f2";
  rrc(c, cx - 0.84 * s, cy - 0.2 * s + st * 0.5, 0.68 * s, 0.3 * s, 0.14 * s);
  c.fill();
  rrc(c, cx + 0.16 * s, cy - 0.2 * s - st * 0.5, 0.68 * s, 0.3 * s, 0.14 * s);
  c.fill();
  c.fillStyle = ch.paddle;
  c.fillRect(cx - 0.55 * s, cy - 0.07 * s + st * 0.5, 0.26 * s, 0.045 * s);
  c.fillRect(cx + 0.45 * s, cy - 0.07 * s - st * 0.5, 0.26 * s, 0.045 * s);
  // Athletic shorts and jersey
  c.fillStyle = "#1e2f3a";
  rrc(c, cx - 0.83 * s, cy - 1.48 * s, 1.66 * s, 0.72 * s, 0.2 * s);
  c.fill();
  c.strokeStyle = "rgba(255,255,255,.22)";
  c.lineWidth = Math.max(1, s * 0.045);
  c.beginPath();
  c.moveTo(cx, cy - 1.42 * s);
  c.lineTo(cx, cy - 0.83 * s);
  c.stroke();
  c.fillStyle = ch.body;
  rrc(c, cx - 0.9 * s, cy - 2.5 * s, 1.8 * s, 1.5 * s, 0.4 * s);
  c.fill();
  c.strokeStyle = "rgba(12,30,38,.38)";
  c.lineWidth = Math.max(1, s * 0.07);
  rrc(c, cx - 0.9 * s, cy - 2.5 * s, 1.8 * s, 1.5 * s, 0.4 * s);
  c.stroke();
  c.fillStyle = "rgba(255,255,255,.18)";
  c.beginPath();
  c.moveTo(cx - 0.68 * s, cy - 2.36 * s);
  c.lineTo(cx - 0.18 * s, cy - 2.36 * s);
  c.lineTo(cx - 0.54 * s, cy - 1.15 * s);
  c.lineTo(cx - 0.76 * s, cy - 1.3 * s);
  c.closePath();
  c.fill();
  c.fillStyle = ch.acc;
  c.fillRect(cx - 0.88 * s, cy - 1.72 * s, 1.76 * s, 0.17 * s);
  c.fillStyle = "rgba(255,255,255,.72)";
  c.beginPath();
  c.moveTo(cx - 0.28 * s, cy - 2.47 * s);
  c.lineTo(cx, cy - 2.2 * s);
  c.lineTo(cx + 0.28 * s, cy - 2.47 * s);
  c.lineTo(cx + 0.14 * s, cy - 2.58 * s);
  c.lineTo(cx - 0.14 * s, cy - 2.58 * s);
  c.closePath();
  c.fill();
  // Neck and free hand
  c.fillStyle = ch.skin;
  rrc(c, cx - 0.24 * s, cy - 2.68 * s, 0.48 * s, 0.48 * s, 0.14 * s);
  c.fill();
  c.fillStyle = ch.body;
  c.beginPath();
  c.arc(cx - hs * 1.05 * s, cy - 1.45 * s, 0.33 * s, 0, 7);
  c.fill();
  c.fillStyle = ch.skin;
  c.beginPath();
  c.arc(cx - hs * 1.05 * s, cy - 1.42 * s, 0.23 * s, 0, 7);
  c.fill();
  // Head and character-specific hair
  c.fillStyle = ch.skin;
  c.beginPath();
  c.arc(cx, hy, hr, 0, 7);
  c.fill();
  c.strokeStyle = "rgba(42,27,24,.3)";
  c.lineWidth = Math.max(1, s * 0.045);
  c.stroke();
  if (back) {
    c.fillStyle = ch.hair;
    c.beginPath();
    c.arc(cx, hy + 0.02 * s, hr * 0.94, 0, 7);
    c.fill();
    c.fillStyle = ch.hair;
    c.beginPath();
    c.arc(cx - 0.73 * s, hy - 0.04 * s, 0.28 * s, 0, 7);
    c.arc(cx + 0.73 * s, hy - 0.04 * s, 0.28 * s, 0, 7);
    c.fill();
    if (ch.hat === "band") {
      c.fillStyle = ch.acc;
      rrc(c, cx - hr * 0.94, hy - 0.2 * s, hr * 1.88, 0.28 * s, 0.12 * s);
      c.fill();
    } else if (ch.hat === "cap") {
      c.fillStyle = ch.acc;
      c.beginPath();
      c.arc(cx, hy - 0.08 * s, hr * 0.98, Math.PI, 2 * Math.PI);
      c.fill();
      c.fillStyle = ch.body;
      c.beginPath();
      c.ellipse(cx + 0.12 * s, hy - 0.02 * s, 0.86 * s, 0.16 * s, 0, 0, 7);
      c.fill();
    }
  } else {
    c.fillStyle = "#fff";
    c.beginPath();
    c.ellipse(cx - 0.34 * s, hy + 0.08 * s, 0.19 * s, 0.23 * s, 0, 0, 7);
    c.ellipse(cx + 0.34 * s, hy + 0.08 * s, 0.19 * s, 0.23 * s, 0, 0, 7);
    c.fill();
    c.fillStyle = "#24313a";
    c.beginPath();
    c.arc(cx - 0.31 * s, hy + 0.1 * s, 0.105 * s, 0, 7);
    c.arc(cx + 0.37 * s, hy + 0.1 * s, 0.105 * s, 0, 7);
    c.fill();
    c.fillStyle = "#fff";
    c.beginPath();
    c.arc(cx - 0.34 * s, hy + 0.04 * s, 0.045 * s, 0, 7);
    c.arc(cx + 0.34 * s, hy + 0.04 * s, 0.045 * s, 0, 7);
    c.fill();
    c.strokeStyle = ch.hair;
    c.lineWidth = Math.max(1.5, s * 0.09);
    c.beginPath();
    c.moveTo(cx - 0.52 * s, hy - 0.2 * s);
    c.lineTo(cx - 0.2 * s, hy - 0.24 * s);
    c.moveTo(cx + 0.2 * s, hy - 0.24 * s);
    c.lineTo(cx + 0.52 * s, hy - 0.2 * s);
    c.stroke();
    c.fillStyle = "rgba(255,120,115,.34)";
    c.beginPath();
    c.ellipse(cx - 0.57 * s, hy + 0.35 * s, 0.16 * s, 0.08 * s, 0, 0, 7);
    c.ellipse(cx + 0.57 * s, hy + 0.35 * s, 0.16 * s, 0.08 * s, 0, 0, 7);
    c.fill();
    c.fillStyle = "rgba(115,65,48,.42)";
    c.beginPath();
    c.arc(cx, hy + 0.26 * s, 0.07 * s, 0, 7);
    c.fill();
    c.strokeStyle = "#713b3b";
    c.lineWidth = Math.max(1.5, s * 0.08);
    c.beginPath();
    c.arc(cx, hy + 0.32 * s, 0.24 * s, 0.2, Math.PI - 0.2);
    c.stroke();
    if (ch.hat === "cap") {
      c.fillStyle = ch.acc;
      c.beginPath();
      c.arc(cx, hy - 0.08 * s, hr * 0.98, Math.PI, 2 * Math.PI);
      c.fill();
      c.fillStyle = ch.body;
      c.beginPath();
      c.ellipse(cx + 0.12 * s, hy - 0.02 * s, 0.86 * s, 0.16 * s, 0, 0, 7);
      c.fill();
    } else {
      c.fillStyle = ch.hair;
      c.beginPath();
      c.arc(cx, hy - 0.05 * s, hr * 1.02, Math.PI * 1.02, Math.PI * 1.98);
      c.fill();
      c.beginPath();
      c.moveTo(cx - 0.83 * s, hy - 0.47 * s);
      c.quadraticCurveTo(cx - 0.38 * s, hy - 1.05 * s, cx + 0.12 * s, hy - 0.81 * s);
      c.quadraticCurveTo(cx + 0.56 * s, hy - 0.98 * s, cx + 0.8 * s, hy - 0.4 * s);
      c.quadraticCurveTo(cx + 0.3 * s, hy - 0.58 * s, cx - 0.12 * s, hy - 0.42 * s);
      c.quadraticCurveTo(cx - 0.52 * s, hy - 0.34 * s, cx - 0.83 * s, hy - 0.47 * s);
      c.fill();
      if (ch.hat === "band") {
        c.fillStyle = ch.acc;
        rrc(c, cx - hr * 0.95, hy - 0.47 * s, hr * 1.9, 0.23 * s, 0.1 * s);
        c.fill();
      }
    }
  }
  if (ch.hat === "bun") {
    c.fillStyle = ch.hair;
    c.beginPath();
    c.arc(cx, hy - hr * 1.02, hr * 0.42, 0, 7);
    c.fill();
    c.fillStyle = "rgba(255,255,255,.18)";
    c.beginPath();
    c.arc(cx - 0.1 * s, hy - hr * 1.12, hr * 0.12, 0, 7);
    c.fill();
  }
  // Racket arm and paddle
  const hx = cx + hs * 1.1 * s,
    hy2 = cy - 1.55 * s,
    q = sw > 0 ? 1 - sw / 0.25 : 0,
    ang = hs * 0.35 - hs * 2.3 * Math.sin(q * Math.PI);
  c.strokeStyle = ch.body;
  c.lineWidth = 0.55 * s;
  c.beginPath();
  c.moveTo(cx + hs * 0.72 * s, cy - 2.23 * s);
  c.lineTo(hx, hy2);
  c.stroke();
  c.strokeStyle = ch.skin;
  c.lineWidth = 0.32 * s;
  c.beginPath();
  c.moveTo(cx + hs * 0.75 * s, cy - 2.16 * s);
  c.lineTo(hx, hy2);
  c.stroke();
  c.save();
  c.translate(hx, hy2);
  c.rotate(ang);
  c.fillStyle = ch.skin;
  rrc(c, -0.13 * s, -0.68 * s, 0.26 * s, 0.72 * s, 0.12 * s);
  c.fill();
  c.fillStyle = "#243b49";
  rrc(c, -0.14 * s, -1.02 * s, 0.28 * s, 0.42 * s, 0.12 * s);
  c.fill();
  c.strokeStyle = "rgba(255,255,255,.45)";
  c.lineWidth = Math.max(1, s * 0.045);
  c.beginPath();
  c.moveTo(-0.11 * s, -0.94 * s);
  c.lineTo(0.11 * s, -0.84 * s);
  c.moveTo(-0.11 * s, -0.82 * s);
  c.lineTo(0.11 * s, -0.72 * s);
  c.stroke();
  c.fillStyle = ch.paddle;
  c.beginPath();
  c.ellipse(0, -1.43 * s, 0.58 * s, 0.72 * s, 0, 0, 7);
  c.fill();
  c.strokeStyle = "rgba(12,30,38,.72)";
  c.lineWidth = Math.max(1.5, s * 0.09);
  c.stroke();
  c.fillStyle = "rgba(255,255,255,.26)";
  c.beginPath();
  c.ellipse(-0.15 * s, -1.64 * s, 0.23 * s, 0.35 * s, -0.2, 0, 7);
  c.fill();
  c.fillStyle = "rgba(18,38,47,.38)";
  for (const [px, py] of [[-0.18, -1.42], [0.18, -1.42], [0, -1.2], [-0.18, -1.68], [0.18, -1.68]]) {
    c.beginPath();
    c.arc(px * s, py * s, Math.max(0.7, 0.055 * s), 0, 7);
    c.fill();
  }
  c.restore();
}
function tag(t, x, y, col) {
  X.font = '800 11px "Court Sans",sans-serif';
  X.textAlign = "center";
  const w = X.measureText(t).width + 12;
  X.fillStyle = "rgba(8,28,34,.78)";
  rrc(X, x - w / 2, y - 9, w, 16, 8);
  X.fill();
  X.fillStyle = col;
  X.fillText(t, x, y + 3);
}
function draw() {
  X.clearRect(0, 0, W, H);
  X.fillStyle = "#12363f";
  X.fillRect(0, 0, W, H);
  if (window.OnlineGame && window.OnlineGame.active) {
    window.OnlineGame.draw({ X, W, H, S, px, py, screenX, screenY, DESKTOP });
    return;
  }
  X.save();
  if (DESKTOP) {
    X.translate(W, 0);
    X.rotate(Math.PI / 2);
  }
  X.fillStyle = "#0d2a31";
  rr(px(-3), py(-4), 26 * S, 52 * S, S * 1.2);
  X.fill();
  X.fillStyle = "#2563a8";
  X.fillRect(px(0), py(0), 20 * S, 44 * S);
  X.fillStyle = "#2e9b78";
  X.fillRect(px(0), py(15), 20 * S, 14 * S);
  if (
    G &&
    G.st === "rally" &&
    G.bn === 0 &&
    G.pl.y >= 22 &&
    G.pl.y <= 29
  ) {
    X.fillStyle = "rgba(255,70,65,.48)";
    X.fillRect(px(0), py(22), 20 * S, 7 * S);
  }
  X.strokeStyle = "#f4f7f2";
  X.lineWidth = Math.max(2, S * 0.14);
  X.strokeRect(px(0), py(0), 20 * S, 44 * S);
  X.beginPath();
  X.moveTo(px(0), py(15));
  X.lineTo(px(20), py(15));
  X.moveTo(px(0), py(29));
  X.lineTo(px(20), py(29));
  X.moveTo(px(10), py(0));
  X.lineTo(px(10), py(15));
  X.moveTo(px(10), py(29));
  X.lineTo(px(10), py(44));
  X.stroke();
  // net
  X.fillStyle = "rgba(0,0,0,.25)";
  X.fillRect(px(-1), py(22), 22 * S, S * 0.3);
  X.fillStyle = "rgba(255,255,255,.2)";
  X.fillRect(px(-1), py(22) - 0.9 * S, 22 * S, 0.9 * S); // net mesh: ball must pass above the white tape
  X.strokeStyle = "rgba(255,255,255,.35)";
  X.lineWidth = 1;
  X.beginPath();
  for (let k = -1; k <= 21; k += 0.75) {
    X.moveTo(px(k), py(22) - 0.9 * S);
    X.lineTo(px(k), py(22));
  }
  X.stroke();
  X.strokeStyle = "#fff";
  X.lineWidth = Math.max(2, S * 0.16);
  X.beginPath();
  X.moveTo(px(-1), py(22) - 0.9 * S);
  X.lineTo(px(21), py(22) - 0.9 * S);
  X.stroke();
  X.fillStyle = "#ddd";
  X.fillRect(px(-1) - 3, py(22) - 0.9 * S - 3, 6, 0.9 * S + 8);
  X.fillRect(px(21) - 3, py(22) - 0.9 * S - 3, 6, 0.9 * S + 8);
  X.restore();
  X.fillStyle = "rgba(255,255,255,.32)";
  X.font = "700 " + Math.round(S * 0.75) + 'px "Court Sans",sans-serif';
  X.textAlign = "center";
  if (DESKTOP) {
    X.fillText("KITCHEN", W - py(18.7), px(10));
    X.fillText("KITCHEN", W - py(26.1), px(10));
  } else {
    X.fillText("KITCHEN", px(10), py(18.7));
    X.fillText("KITCHEN", px(10), py(26.1));
  }
  if (!G) {
    return;
  }
  const b = G.b;
  if (G.st === "rally" && b.vz !== 0) {
    const fallTime =
      (b.vz + Math.sqrt(Math.max(0, b.vz * b.vz + 2 * GR * Math.max(b.z, 0)))) /
      GR;
    const landingX = b.x + b.vx * fallTime;
    const landingY = b.y + b.vy * fallTime;
    const landingScreenX = screenX(landingX, landingY);
    const landingScreenY = screenY(landingX, landingY);
    const landingIsIn =
      landingX >= 0 && landingX <= 20 && landingY >= 0 && landingY <= 44;
    X.save();
    X.strokeStyle = landingIsIn ? "rgba(232,242,76,.95)" : "rgba(255,107,87,.95)";
    X.fillStyle = landingIsIn ? "rgba(232,242,76,.17)" : "rgba(255,107,87,.17)";
    X.lineWidth = Math.max(2, S * 0.12);
    X.beginPath();
    X.ellipse(landingScreenX, landingScreenY, S * 1.15, S * 0.68, 0, 0, Math.PI * 2);
    X.fill();
    X.stroke();
    X.restore();
  }
  if (!settings.lowQuality && ballTrail.length > 1) {
    ballTrail.forEach((point, index) => {
      const progress = (index + 1) / ballTrail.length;
      X.fillStyle = `rgba(232,242,76,${progress * 0.38})`;
      X.beginPath();
      X.arc(
        screenX(point.x, point.y),
        screenY(point.x, point.y) - point.z * S * 0.45,
        Math.max(1.5, S * 0.16 * progress),
        0,
        Math.PI * 2,
      );
      X.fill();
    });
  }
  if (!settings.lowQuality && hitFx) {
    const progress = hitFx.t / 0.2;
    X.strokeStyle = `rgba(255,255,255,${progress})`;
    X.lineWidth = Math.max(1, S * 0.12);
    X.beginPath();
    X.arc(
      screenX(hitFx.x, hitFx.y),
      screenY(hitFx.x, hitFx.y) - hitFx.z * S * 0.45,
      S * (0.45 + (1 - progress) * 0.95),
      0,
      Math.PI * 2,
    );
    X.stroke();
  }
  const plx = screenX(G.pl.x, G.pl.y),
    ply = screenY(G.pl.x, G.pl.y);
  const aiPlayers = [
    { actor: G.ai, ch: G.aich, label: G.aiMate ? "AI 1 · " : "AI · " },
  ];
  if (G.aiMate)
    aiPlayers.push({ actor: G.aiMate, ch: G.aiMateCh, label: "AI 2 · " });
  aiPlayers.forEach(({ actor, ch, label }) => {
    const x = screenX(actor.x, actor.y),
      y = screenY(actor.x, actor.y);
    drawChar(X, x, y, S * 0.8, ch, actor.sw, -1, actor.mv, G.t);
    tag(label + ch.n, x, y - 4.7 * S * 0.8, "#f2c14e");
  });
  // ball shadow + ball
  const bx = screenX(b.x, b.y),
    by = screenY(b.x, b.y);
  X.fillStyle = "rgba(0,0,0,.35)";
  X.beginPath();
  X.ellipse(bx, by, S * 0.5, S * 0.3, 0, 0, 7);
  X.fill();
  const br = S * 0.52 * (1 + b.z * 0.035);
  X.fillStyle = "#e8f24c";
  X.beginPath();
  X.arc(bx, by - b.z * S * 0.45, br, 0, 7);
  X.fill();
  X.strokeStyle = "rgba(0,0,0,.35)";
  X.lineWidth = 1.5;
  X.stroke();
  if (G.mate) {
    const mx = screenX(G.mate.x, G.mate.y),
      my = screenY(G.mate.x, G.mate.y);
    drawChar(X, mx, my, S * 0.8, G.mateCh, G.mate.sw, 1, G.mate.mv, G.t);
    tag("PARTNER", mx, my - 4.7 * S * 0.8, "#7dffb2");
  }
  drawChar(X, plx, ply, S * 0.8, G.ch, G.pl.sw, 1, G.pl.mv, G.t);
  tag(cleanDisplayName(settings.displayName), plx, ply - 4.7 * S * 0.8, "#ff9a8c");
  if (!settings.lowQuality) {
    pointParticles.forEach((particle) => {
      X.globalAlpha = Math.min(1, particle.t * 1.5);
      X.fillStyle = particle.t > 0.5 ? "#e8f24c" : "#ff9a8c";
      X.beginPath();
      X.arc(particle.x, particle.y, 3.5, 0, Math.PI * 2);
      X.fill();
    });
    X.globalAlpha = 1;
  }
  // touch feedback
  for (const k in tp) {
    const t = tp[k];
    X.lineWidth = 3;
    if (t.m) {
      const l = Math.hypot(t.x - t.x0, t.y - t.y0),
        m = l > 55 ? 55 / l : 1;
      X.strokeStyle = "rgba(255,255,255,.4)";
      X.beginPath();
      X.arc(t.x0, t.y0, 55, 0, 7);
      X.stroke();
      X.fillStyle = "rgba(255,255,255,.5)";
      X.beginPath();
      X.arc(t.x0 + (t.x - t.x0) * m, t.y0 + (t.y - t.y0) * m, 20, 0, 7);
      X.fill();
    } else {
      X.strokeStyle = "#e8f24c";
      X.beginPath();
      X.moveTo(t.x0, t.y0);
      X.lineTo(t.x, t.y);
      X.stroke();
    }
  }
  if (!document.getElementById("touchControls").classList.contains("active")) {
    X.textAlign = "center";
    X.fillStyle = "rgba(255,255,255,.3)";
    X.font = '700 13px "Court Sans",sans-serif';
    X.fillText(KB ? "WASD move" : "MOVE", W * 0.25, H - 14 - SB);
    X.fillText(KB ? "SPACE hit" : "HIT", W * 0.75, H - 14 - SB);
    if (G.st === "serve" && G.srv === 1) {
      X.fillStyle = "#fff";
      X.font = '800 17px "Court Sans",sans-serif';
      X.fillText(
        G.mode === "doubles"
          ? KB
            ? "Your team serves: press Space"
            : "Your team serves: tap HIT"
          : KB
            ? "Your serve: press Space (arrows aim)"
            : "Your serve: swipe on the right side",
        W / 2,
        H - 38 - SB,
        W - 24,
      );
    }
    if (G.st === "serve" && G.srv === 0) {
      X.fillStyle = "#fff";
      X.font = '800 17px "Court Sans",sans-serif';
      X.fillText(
        G.mode === "doubles"
          ? KB
            ? "AI team serves. Let it bounce, then hit"
            : "AI team serves. Let it bounce, then tap HIT"
          : KB
            ? "AI serves. Let it bounce, then hit"
            : "AI serves. Let it bounce, then swipe to return",
        W / 2,
        H - 38 - SB,
        W - 24,
      );
    }
  }
  if (G.st === "point") {
    X.fillStyle = "rgba(8,28,34,.86)";
    rr(W / 2 - 160, H / 2 - 56, 320, G.note ? 122 : 100, 16);
    X.fill();
    X.fillStyle = "#e8f24c";
    X.font = '800 22px "Court Sans",sans-serif';
    X.fillText(G.msg, W / 2, H / 2 - 14, 296);
    X.fillStyle = G.wb === 1 ? "#7dffb2" : "#ff9a8c";
    X.font = '800 18px "Court Sans",sans-serif';
    X.fillText(G.sub, W / 2, H / 2 + 18, 296);
    if (G.note) {
      X.fillStyle = "rgba(255,255,255,.75)";
      X.font = '700 13px "Court Sans",sans-serif';
      X.fillText(G.note, W / 2, H / 2 + 44, 296);
    }
  }
}

/* ---------- UI wiring ---------- */
const $ = (id) => document.getElementById(id);
let lastTxt = "";
function showMobileHome() {
  $("menu").classList.remove("rules-open");
  $("menu").scrollTop = 0;
  ["mobileHome", "mobileMode", "mobileChoose", "mobileRulesPage", "mobilePracticePage", "mobileSettingsPage"].forEach((id) =>
    $(id).classList.toggle("hide", id !== "mobileHome"),
  );
}
function showMobilePage(page) {
  $("menu").scrollTop = 0;
  $("menu").classList.toggle("rules-open", page === "mobileRulesPage");
  ["mobileHome", "mobileMode", "mobileChoose", "mobileRulesPage", "mobilePracticePage", "mobileSettingsPage"].forEach((id) =>
    $(id).classList.toggle("hide", id !== page),
  );
  $(page).classList.remove("hide");
}
function updateTouchControls() {
  const touch =
    matchMedia("(max-width:760px)").matches ||
    matchMedia("(hover:none) and (pointer:coarse)").matches;
  const gameActive =
    ((window.OnlineGame && window.OnlineGame.active) ||
      (G && !G.paused && !G.over)) &&
    $("menu").classList.contains("hide") &&
    $("chars").classList.contains("hide") &&
    $("msgov").classList.contains("hide") &&
    $("online").classList.contains("hide");
  const touchControlsActive = Boolean(gameActive && touch);
  $("touchControls").classList.toggle("active", touchControlsActive);
  $("mobileSkillControls").classList.toggle("active", touchControlsActive);
  $("desktopSkillControls").classList.toggle("active", Boolean(gameActive && !touch));
  $("touchControls").classList.toggle("left-handed", settings.leftHanded);
  if (!touchControlsActive) resetMoveStick();
}
function skillState() {
  if (window.OnlineGame?.active) return window.OnlineGame.getSkillState();
  return {
    cooldowns: G?.skillCooldowns || { drive: 0, drop: 0, curve: 0 },
    dropAllowed: Boolean(G && G.st === "rally"),
  };
}
function renderScoreboard(leftName, leftScore, rightName, rightScore, status) {
  const score = $("score");
  const row = document.createElement("div");
  row.className = "scoreboard-row";
  [
    [leftName, leftScore],
    [rightName, rightScore],
  ].forEach(([name, points], index) => {
    if (index) {
      const separator = document.createElement("span");
      separator.className = "scoreboard-separator";
      separator.textContent = "–";
      row.appendChild(separator);
    }
    const team = document.createElement("div");
    team.className = "scoreboard-team";
    const label = document.createElement("span");
    label.className = "scoreboard-name";
    label.textContent = name;
    const value = document.createElement("strong");
    value.className = "scoreboard-points";
    value.textContent = points;
    team.append(label, value);
    row.appendChild(team);
  });
  const detail = document.createElement("small");
  detail.className = "scoreboard-status";
  detail.textContent = status;
  score.replaceChildren(row, detail);
}
function refreshSkillControls() {
  const state = skillState();
  if (pendingSkillHit && performance.now() >= pendingSkillHit.expiresAt) {
    pendingSkillHit = null;
  }
  document.querySelectorAll(".skill-button").forEach((button) => {
    const skill = button.dataset.skill;
    const cooldown = Math.max(0, state.cooldowns[skill] || 0);
    const unavailable = cooldown > 0 || (skill === "drop" && !state.dropAllowed);
    button.disabled = unavailable;
    button.querySelector(".skill-cooldown").textContent = cooldown > 0
      ? `${Math.ceil(cooldown)}s`
      : skill === "drop" && !state.dropAllowed
        ? "RALLY"
        : "READY";
    button.title = cooldown > 0
      ? `${SKILL_LABELS[skill]} ready in ${Math.ceil(cooldown)} seconds`
      : skill === "drop" && !state.dropAllowed
        ? "Drop Shot can only be used during a rally"
        : SKILL_LABELS[skill];
  });
}
function executeSkill(skill) {
  if (!SKILL_COOLDOWNS[skill]) return;
  const state = skillState();
  if ((state.cooldowns[skill] || 0) > 0 || (skill === "drop" && !state.dropAllowed)) return;
  if (!(window.OnlineGame?.active) && (!G || G.paused || G.over)) return;
  const neutral = Math.hypot(stick.x, stick.y) < 0.15;
  const dx = stick.x * W * 0.28,
    dy = neutral ? -H * 0.18 : stick.y * H * 0.28;
  if (window.OnlineGame?.active) {
    pendingSkillHit = { skill, dx, dy, expiresAt: performance.now() + SKILL_HIT_BUFFER_MS, online: true };
    pSwing(dx, dy, skill);
  } else if (canPlayerSkillHit(skill)) {
    if (!pSwing(dx, dy, skill)) pendingSkillHit = { skill, dx, dy, expiresAt: performance.now() + SKILL_HIT_BUFFER_MS, online: false };
  } else {
    pendingSkillHit = { skill, dx, dy, expiresAt: performance.now() + SKILL_HIT_BUFFER_MS, online: false };
  }
  refreshSkillControls();
}
matchMedia(
  "(max-width:760px), (hover:none) and (pointer:coarse)",
).addEventListener("change", updateTouchControls);
function hud() {
  refreshSkillControls();
  if (window.OnlineGame && window.OnlineGame.active) return;
  if (!G) return;
  const off = G.scoring !== "rally",
    t =
      G.mode === "doubles"
        ? `Team ${G.sc[1]} – AI team ${G.sc[0]}`
        : `You ${G.sc[1]} – ${G.sc[0]} AI`,
    sv =
      (G.srv === 1
        ? G.mode === "doubles"
          ? "Your team serves"
          : "Your serve"
        : G.mode === "doubles"
          ? "AI team serves"
          : "AI serve") +
      (off ? ` · call ${G.sc[G.srv]}–${G.sc[1 - G.srv]}` : ""),
    k = t + sv;
  if (k !== lastTxt) {
    lastTxt = k;
    renderScoreboard(
      G.mode === "doubles" ? "YOUR TEAM" : "YOU",
      G.sc[1],
      G.mode === "doubles" ? "AI TEAM" : "AI",
      G.sc[0],
      sv,
    );
  }
}
function showMsg(t, p, b1, f1, canResume, difficulty = "") {
  $("mt").textContent = t;
  $("mp").textContent = p;
  $("resultDifficulty").textContent = difficulty;
  $("resultDifficulty").hidden = !difficulty;
  $("b1").textContent = b1;
  $("b3").textContent = t === "Paused" ? "Quit Game" : "Main menu";
  $("b3").style.display = "";
  $("b1").onclick = () => {
    $("msgov").classList.add("hide");
    f1();
    updateTouchControls();
  };
  $("b2").style.display = canResume ? "" : "none";
  $("msgov").classList.remove("hide");
}
function pause() {
  if (window.OnlineGame?.active) {
    window.OnlineGame.pause();
    return;
  }
  if (!G || G.over || G.paused || !$("menu").classList.contains("hide")) return;
  G.paused = true;
  G.pausedAt = performance.now();
  showMsg(
    "Paused",
    "The game is stopped. Continue when you are ready.",
    "Resume",
    () => {
      const pausedFor = performance.now() - G.pausedAt;
      if (pendingSkillHit) pendingSkillHit.expiresAt += pausedFor;
      G.pausedAt = 0;
      G.paused = false;
    },
    true,
  );
}
$("pa").onclick = () => {
  if (window.OnlineGame && window.OnlineGame.active) {
    window.OnlineGame.pause();
    return;
  }
  pause();
};
$("b2").onclick = () => {
  $("msgov").classList.add("hide");
  newGame(diffKey);
};
$("b3").onclick = () => {
  $("msgov").classList.add("hide");
  if (window.OnlineGame?.active) {
    window.OnlineGame.leave(true);
    return;
  }
  showMobileHome();
  $("menu").classList.remove("hide");
  updateTouchControls();
};
$("mu").onclick = () => {
  muted = !muted;
  $("mu").setAttribute("aria-label", muted ? "Unmute sound" : "Mute sound");
  $("mu").title = muted ? "Unmute sound" : "Mute sound";
  $("mu").innerHTML = muted
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h4l5 4V6l-5 4H4Z"/><path d="m17 9 5 6m0-6-5 6"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h4l5 4V6l-5 4H4Z"/><path d="M16 9a5 5 0 0 1 0 6m3-9a9 9 0 0 1 0 12"/></svg>';
};
$("mobilePlay").onclick = () => showMobilePage("mobileMode");
$("mobileModeBack").onclick = showMobileHome;
$("mobileChooseBack").onclick = () => showMobilePage("mobileMode");
let practiceStep = 0;
const practiceSteps = [
  "Move with the stick or WASD and watch the landing ring to get behind the ball.",
  "Let the serve bounce, then return it before its second bounce with HIT or Space.",
  "Aim with the stick or arrow keys as you hit. A centered input sends a straight shot.",
];
function updatePractice() {
  $("practiceCopy").textContent = practiceSteps[practiceStep];
  $("practiceProgress").textContent = `${practiceStep + 1} / ${practiceSteps.length}`;
  $("practiceNext").textContent = practiceStep === practiceSteps.length - 1 ? "Start practice" : "Next";
}
$("mobilePractice").onclick = () => {
  practiceStep = 0;
  updatePractice();
  showMobilePage("mobilePracticePage");
};
$("practiceNext").onclick = () => {
  if (practiceStep < practiceSteps.length - 1) {
    practiceStep++;
    updatePractice();
    return;
  }
  gameMode = "singles";
  diffKey = "easy";
  $("menu").classList.add("hide");
  newGame(diffKey);
};
$("practiceBack").onclick = showMobileHome;
function saveSettings() {
  try {
    localStorage.setItem("courtClashSettings", JSON.stringify(settings));
  } catch (_) {}
}
function updateSettingsUI() {
  $("displayName").value = settings.displayName;
  $("leftHanded").checked = settings.leftHanded;
  $("haptics").checked = settings.haptics;
  $("lowQuality").checked = settings.lowQuality;
  $("masterVolume").value = Math.round(settings.masterVolume * 100);
  $("effectsVolume").value = Math.round(settings.effectsVolume * 100);
  $("masterValue").value = `${Math.round(settings.masterVolume * 100)}%`;
  $("effectsValue").value = `${Math.round(settings.effectsVolume * 100)}%`;
}
window.CourtClashProfile = {
  getName: () => cleanDisplayName(settings.displayName),
  getCharacterName: () => CHARS[sel].n,
  getCharacterId: () => sel,
  getCharacters: () => CHARS.map(({ n, d, spd, reach }) => ({ name: n, description: d, speed: spd, reach })),
  selectCharacter(id) {
    if (!Number.isInteger(id) || id < 0 || id >= CHARS.length) return;
    sel = id;
    window.dispatchEvent(new CustomEvent("courtclash:profilechange"));
  },
  drawCharacterPreview(context, id) {
    const character = CHARS[id];
    if (character) drawChar(context, 60, 110, 20, character, 0, -1, false, 0);
  },
};
$("displayName").oninput = (e) => {
  settings.displayName = cleanDisplayName(e.target.value);
  saveSettings();
  window.dispatchEvent(new CustomEvent("courtclash:profilechange"));
};
$("mobileSettingsOpen").onclick = () => {
  updateSettingsUI();
  showMobilePage("mobileSettingsPage");
};
$("mobileSettingsBack").onclick = showMobileHome;
$("leftHanded").onchange = (e) => {
  settings.leftHanded = e.target.checked;
  saveSettings();
  updateTouchControls();
};
$("haptics").onchange = (e) => {
  settings.haptics = e.target.checked;
  saveSettings();
};
$("lowQuality").onchange = (e) => {
  settings.lowQuality = e.target.checked;
  saveSettings();
  rs();
};
[["masterVolume", "masterValue", "masterVolume"], ["effectsVolume", "effectsValue", "effectsVolume"]].forEach(
  ([id, output, key]) => {
    $(id).oninput = (e) => {
      settings[key] = Number(e.target.value) / 100;
      $(output).value = `${e.target.value}%`;
      saveSettings();
    };
  },
);
updateSettingsUI();
document.querySelectorAll("[data-mode]").forEach(
  (bt) =>
    (bt.onclick = () => {
      gameMode = bt.dataset.mode;
      showMobilePage("mobileChoose");
    }),
);
$("mobileRulesOpen").onclick = () => showMobilePage("mobileRulesPage");
$("mobileRulesBack").onclick = showMobileHome;
function openChars() {
  const g = $("grid");
  g.innerHTML = "";
  CHARS.forEach((ch, i) => {
    const d = document.createElement("button");
    d.className = "card" + (i === sel ? " on" : "");
    const cv = document.createElement("canvas");
    cv.width = cv.height = 120;
    cv.style.cssText = "width:64px;height:64px";
    drawChar(cv.getContext("2d"), 60, 110, 20, ch, 0, -1, false, 0);
    d.appendChild(cv);
    const sp = Math.round(((ch.spd - 0.7) / 0.6) * 100),
      rc = Math.round(((ch.reach - 2.8) / 1.6) * 100);
    d.insertAdjacentHTML(
      "beforeend",
      "<b>" +
        ch.n +
        "</b><span>" +
        ch.d +
        '</span><div class="lab">Speed</div><div class="bar"><i style="width:' +
        sp +
        '%"></i></div><div class="lab">Reach</div><div class="bar r"><i style="width:' +
        rc +
        '%"></i></div>',
    );
    d.onclick = () => {
      sel = i;
      openChars();
    };
    g.appendChild(d);
  });
  $("chars").classList.remove("hide");
  updateTouchControls();
}
document.querySelectorAll("[data-d]").forEach(
  (bt) =>
    (bt.onclick = () => {
      audio();
      diffKey = bt.dataset.d;
      $("menu").classList.add("hide");
      openChars();
    }),
);
function scUI() {
  $("sc").textContent =
    "Scoring: " +
    (scoring === "official" ? "Official (side-out)" : "Fair rally");
  $("scd").textContent =
    scoring === "official"
      ? "Official pickleball: only the server scores. If the server loses the rally, the serve changes with no point."
      : "Every rally scores. If the mistake is yours, the AI gets the point. If it is the AI's, you get it.";
}
$("sc").onclick = () => {
  scoring = scoring === "official" ? "rally" : "official";
  scUI();
};
scUI();
$("go").onclick = () => {
  audio();
  $("chars").classList.add("hide");
  newGame(diffKey);
};
$("back").onclick = () => {
  $("chars").classList.add("hide");
  $("menu").classList.remove("hide");
  updateTouchControls();
};
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pause();
});
document.addEventListener("contextmenu", (e) => e.preventDefault());

let lt = 0;
function loop(ts) {
  const dt = Math.min(0.033, (ts - lt) / 1000 || 0);
  lt = ts;
  if (window.OnlineGame && window.OnlineGame.active) window.OnlineGame.update(dt);
  else if (G && !G.paused && !G.over) upd(dt);
  hud();
  draw();
  requestAnimationFrame(loop);
}
window.CourtClashUI = {
  updateTouchControls,
  refreshSkillControls,
  renderScoreboard,
  setOnlinePaused(paused) {
    if (paused) {
      showMsg(
        "Paused",
        "The match is paused for both players. Continue or quit the match.",
        "Continue",
        () => window.OnlineGame?.resume(),
        false,
      );
    } else if ($("mt").textContent === "Paused") {
      $("msgov").classList.add("hide");
      $("b3").style.display = "";
      updateTouchControls();
    }
  },
  drawOnlinePlayer(context, x, y, size, characterIndex, facing, time) {
    const character = CHARS[Number.isInteger(characterIndex) ? characterIndex : 0];
    drawChar(context, x, y, size, character, 0, facing, false, time);
  },
};
window.CourtClashEffects = { audio, paddlePop, buzz };
requestAnimationFrame(loop);

// Kullabacken — Marres bil i backarna
// Fysik: fart, acceleration, gravitation. Ingen krasch, bara lek.

const cv = document.getElementById('c');
const ctx = cv.getContext('2d');
let W = 1280, H = 720, DPR = 1;

const smal = () => Math.min(window.innerWidth, window.innerHeight) < 480;
function portraitPhone() { return smal() && window.innerHeight > window.innerWidth; }
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = Math.max(320, window.innerWidth);
  H = Math.max(280, window.innerHeight);
  cv.width = Math.floor(W * DPR);
  cv.height = Math.floor(H * DPR);
  cv.style.width = W + 'px';
  cv.style.height = H + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const hint = document.getElementById('vand');
  if (hint) hint.classList.toggle('on', portraitPhone());
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', function () { setTimeout(resize, 200); });

// --- marken ---------------------------------------------------
const GROUND = 0.62;
const GAS = 250, BRAKE = 430, GRAV = 560, DRAG = 0.55;

function terrainY(x) {
  return -95 * Math.sin(x / 520) - 54 * Math.sin(x / 230 + 1.3) - 22 * Math.sin(x / 105 + 0.4);
}
function slopeAt(x) { return (terrainY(x + 6) - terrainY(x - 6)) / 12; }

// --- bilen ----------------------------------------------------
const car = { x: 120, v: 0, angle: 0, wheel: 0, air: 0 };
let pitch = 0, tipTime = 0, invuln = 0, krasch = null, holdT = 0, paused = false;
let brakeV = 0, wasBrake = false;
const cam = { x: 0, y: 0 };
let stars = [], parts = [], score = 0, dist = 0, t0 = performance.now(), time = 0;
let celebrating = 0, hintT = 0;

function addStars(upto) {
  for (let x = 380 + stars.length * 340; x < upto + W; x += 340) {
    stars.push({ wx: x, taken: false, ph: Math.random() * 6.28 });
  }
}
addStars(2400);

function reset() {
  car.x = 120; car.v = 0; car.angle = 0; car.wheel = 0;
  pitch = 0; tipTime = 0; invuln = 0; krasch = null; holdT = 0; brakeV = 0; wasBrake = false;
  stars = []; score = 0; dist = 0; addStars(2400);
}

// --- ljud -----------------------------------------------------
let actx = null, master = null, analyser = null;
const MASTER_VOL = 4.2;   // allt ljud går genom denna buss så volymen kan höjas på ett ställe

function audio() {
  if (!actx) {
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      // kompressor hindrar att det skorrar när mastern är uppskruvad
      const comp = actx.createDynamicsCompressor();
      comp.threshold.value = -6; comp.knee.value = 24; comp.ratio.value = 5;
      comp.attack.value = 0.003; comp.release.value = 0.25;
      master = actx.createGain();
      master.gain.value = MASTER_VOL;
      analyser = actx.createAnalyser();
      analyser.fftSize = 2048;
      master.connect(comp); comp.connect(analyser); analyser.connect(actx.destination);
      engineStart();
    } catch (e) {}
  }
  // iOS startar ljudet i pausat läge tills man rör skärmen
  if (actx && actx.state === 'suspended') actx.resume();
  return actx;
}
function tone(f, dur, vol, type, slide) {
  const a = audio(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type || 'sine'; o.frequency.value = f;
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, slide), a.currentTime + dur);
  g.gain.value = vol || 0.04;
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  o.connect(g); g.connect(master || a.destination);
  o.start(); o.stop(a.currentTime + dur);
}
let engOsc = null, engFilter = null, engGain = null;
function engineStart() {
  const a = audio(); if (!a || engOsc) return;
  engOsc = a.createOscillator();
  engOsc.type = 'sawtooth';
  engOsc.frequency.value = 60;
  engFilter = a.createBiquadFilter();
  engFilter.type = 'lowpass';
  engFilter.frequency.value = 700;
  engGain = a.createGain();
  engGain.gain.value = 0.0;
  engOsc.connect(engFilter); engFilter.connect(engGain); engGain.connect(master);
  engOsc.start();
}
function engineUpdate() {
  if (!actx || !engOsc) return;
  const sp = Math.min(1, Math.abs(car.v) / 700);
  const t = actx.currentTime;
  engOsc.frequency.setTargetAtTime(58 + sp * 130, t, 0.08);
  engFilter.frequency.setTargetAtTime(420 + sp * 1500, t, 0.10);
  // tomgång hörs svagt, full gas hörs tydligt
  engGain.gain.setTargetAtTime(0.05 + sp * 0.12, t, 0.08);
}
function engineSound() { engineUpdate(); }

// --- vältan ---------------------------------------------------
function startKrasch(dir) {
  krasch = { t: 0, dir: dir, said: false };
  tipTime = 0;
  if (Math.abs(car.v) < 40) car.v = 0;
  celebrating = 0;
}

function crashSound() {
  // fånigt: boing, duns och en liten tuta
  tone(320, 0.16, 0.11, 'triangle', 150);
  setTimeout(function () { tone(240, 0.20, 0.11, 'sine', 100); }, 110);
  setTimeout(function () { tone(150, 0.28, 0.13, 'sine', 65); }, 240);
  setTimeout(function () { tone(620, 0.09, 0.07, 'square', 470); }, 400);
  setTimeout(function () { tone(430, 0.09, 0.06, 'square', 320); }, 490);
}

function easeOutBack(u) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2);
}
function flipSpin(t, dir) {
  const A = Math.PI * 1.02 * dir;
  if (t < 0.55) { const u = t / 0.55; return A * u * u; }
  if (t < 1.75) return A + Math.sin((t - 0.55) * 20) * 0.015;
  const u = Math.min(1, (t - 1.75) / 0.5);
  return A * (1 - easeOutBack(u));
}

// --- inmatning ------------------------------------------------
let gas = false, brake = false;
function setGas(v) { gas = v; document.getElementById('gas').classList.toggle('down', v); if (v) audio(); }
function setBrake(v) { brake = v; document.getElementById('broms').classList.toggle('down', v); if (v) audio(); }

function bindHold(el, on, off) {
  el.addEventListener('pointerdown', function (e) { e.preventDefault(); on(); });
  el.addEventListener('pointerup', function (e) { e.preventDefault(); off(); });
  el.addEventListener('pointercancel', function () { off(); });
  el.addEventListener('pointerleave', function () { off(); });
}
bindHold(document.getElementById('gas'), function () { setGas(true); }, function () { setGas(false); });
bindHold(document.getElementById('broms'), function () { setBrake(true); }, function () { setBrake(false); });

window.addEventListener('keydown', function (e) {
  if (e.key === 'ArrowRight' || e.key === ' ') setGas(true);
  if (e.key === 'ArrowLeft') setBrake(true);
});
window.addEventListener('keyup', function (e) {
  if (e.key === 'ArrowRight' || e.key === ' ') setGas(false);
  if (e.key === 'ArrowLeft') setBrake(false);
});

const panel = document.getElementById('panel');
document.getElementById('info').addEventListener('click', function () { panel.classList.add('on'); speak('Håll gasen inne för att accelerera. Bromsa i nedförsbacken.'); });
document.getElementById('close').addEventListener('click', function () { panel.classList.remove('on'); });

function speak(txt) {
  /* rösten är en inspelad mp3-fil (Shipholm TTS) – saknas den är appen tyst */
  if (!txt) return;
  if (window.__rost && window.__rost(txt)) return;
}

// --- fysik ----------------------------------------------------
function update(dt) {
  time += dt;
  if (paused || portraitPhone()) return;

  if (krasch) {
    // vältanimeringsläge: bilen står stilla, guppar och reser sig
    krasch.t += dt;
    car.v = 0;
    if (!krasch.said && krasch.t > 0.10) { krasch.said = true; speak('Aj aj aj!'); crashSound(); }
    if (krasch.t > 0.7 && Math.random() < 0.25) {
      parts.push({ x: car.x + (Math.random() - 0.5) * 70, y: terrainY(car.x) - 6, vx: (Math.random() - 0.5) * 110, vy: -30 - Math.random() * 50, r: 4 + Math.random() * 7, life: 1 });
    }
    if (krasch.t > 2.3) { krasch = null; pitch = 0; tipTime = 0; invuln = 1.4; holdT = 0; }
  } else {
    const slope = slopeAt(car.x);
    const theta = Math.atan(slope);
    let a = 0;
    if (gas) a += GAS * (1 - Math.min(0.55, Math.abs(car.v) / 1400));
    if (brake) a -= BRAKE;
    a += GRAV * Math.sin(theta) * 0.9;
    a -= car.v * DRAG;

    // --- vältbenägenhet: håller man gasen inne på låg fart reser bilen sig mer
    // och mer och välter till slut bakåt. Hård broms i fart dyker nosen framåt.
    if (gas && Math.abs(car.v) < 300) holdT += dt;
    else holdT = Math.max(0, holdT - dt * 3.5);
    const wheelie = gas ? Math.max(0, Math.min(1, (holdT - 1.4) / 0.8)) : 0;
    // reser sig bilen på bakhjulen tappar den greppet – den varvar men kör inte iväg
    if (wheelie > 0) a *= (1 - 0.9 * wheelie);

    car.v += a * dt;
    if (!gas && !brake && Math.abs(car.v) < 34) car.v = 0;
    car.v = Math.max(-330, Math.min(880, car.v));
    car.x += car.v * dt;
    if (car.x < 0) { car.x = 0; car.v = Math.max(0, car.v); }
    car.angle = Math.atan(slope);
    car.wheel += car.v * dt / 26;
    dist = Math.max(dist, car.x / 26);

    // nosen dyker om man bromsar hårt från hög fart (farten när bromsen trycks ner räknas)
    if (brake && !wasBrake) brakeV = Math.max(0, car.v);
    const nose = brake ? Math.min(1, brakeV / 300) : 0;
    wasBrake = brake;
    let target = -0.70 * wheelie + 0.62 * nose;
    target = Math.max(-0.70, Math.min(0.62, target));
    const follow = (gas || brake) ? 5.2 : 7.5;
    pitch += (target - pitch) * Math.min(1, dt * follow);
    if (invuln > 0) invuln -= dt;
    if (invuln <= 0 && Math.abs(pitch) > 0.50) {
      tipTime += dt;
      if (tipTime > 0.24) startKrasch(pitch > 0 ? 1 : -1);
    } else if (tipTime > 0) {
      tipTime = Math.max(0, tipTime - dt * 2);
    }

    engineUpdate();
  }

  // damm
  if (gas && Math.abs(car.v) > 40 && Math.random() < 0.6) {
    parts.push({ x: car.x - 30, y: terrainY(car.x) - 8 + (Math.random() - 0.5) * 10, vx: -60 - Math.random() * 80, vy: -20 - Math.random() * 40, r: 4 + Math.random() * 8, life: 1 });
  }

  // stjärnor
  addStars(car.x + W * 2);
  for (const s of stars) {
    if (!s.taken && Math.abs(s.wx - car.x) < 50) {
      s.taken = true; score++;
      tone(880, 0.12, 0.09, 'triangle', 1320);
      if (score % 10 === 0) { celebrating = 2.2; speak(score + ' stjärnor!'); tone(1180, 0.2, 0.05, 'sine'); }
    }
  }
  parts = parts.filter(function (p) {
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 60 * dt; p.life -= dt * 1.4;
    return p.life > 0;
  });

  // kamera
  const targetX = car.x - W * (H > W ? 0.44 : 0.34);
  cam.x += (targetX - cam.x) * Math.min(1, dt * 6);
  const targetY = terrainY(car.x) - H * GROUND;
  cam.y += (targetY - cam.y) * Math.min(1, dt * 3);
  if (celebrating > 0) celebrating -= dt;
  hintT += dt;
}

// --- rita -----------------------------------------------------
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawSky() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#bfe3f2');
  g.addColorStop(0.6, '#e8f6fb');
  g.addColorStop(1, '#fdf3e7');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // sol
  ctx.fillStyle = 'rgba(247,201,72,.28)';
  ctx.beginPath(); ctx.arc(W * 0.82, H * 0.16, 78, 0, 6.3); ctx.fill();
  ctx.fillStyle = '#f7c948';
  ctx.beginPath(); ctx.arc(W * 0.82, H * 0.16, 48, 0, 6.3); ctx.fill();
  // moln
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  for (let i = 0; i < 4; i++) {
    const cx = ((i * 420 - cam.x * 0.12) % (W + 400) + W + 400) % (W + 400) - 200;
    const cy = H * (0.14 + (i % 3) * 0.06);
    ctx.beginPath();
    ctx.arc(cx, cy, 34, 0, 6.3);
    ctx.arc(cx + 38, cy + 6, 26, 0, 6.3);
    ctx.arc(cx - 38, cy + 8, 22, 0, 6.3);
    ctx.fill();
  }
}

function drawGround() {
  const step = 14;
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let sx = 0; sx <= W + step; sx += step) {
    const wx = sx + cam.x;
    ctx.lineTo(sx, terrainY(wx) - cam.y);
  }
  ctx.lineTo(W, H); ctx.closePath();
  const g = ctx.createLinearGradient(0, H * 0.4, 0, H);
  g.addColorStop(0, '#8ecf9c');
  g.addColorStop(0.5, '#6fbf85');
  g.addColorStop(1, '#4f9c69');
  ctx.fillStyle = g;
  ctx.fill();

  // gräskant
  ctx.strokeStyle = '#a8ddb2'; ctx.lineWidth = 8; ctx.beginPath();
  for (let sx = 0; sx <= W + step; sx += step) {
    const y = terrainY(sx + cam.x) - cam.y;
    if (sx === 0) ctx.moveTo(sx, y); else ctx.lineTo(sx, y);
  }
  ctx.stroke();

  // blommor och träd
  for (let i = Math.floor(cam.x / 260); i < Math.floor((cam.x + W) / 260) + 1; i++) {
    const wx = i * 260 + 70;
    const y = terrainY(wx) - cam.y;
    const sx = wx - cam.x;
    if (i % 3 === 0) {
      ctx.fillStyle = '#8a5f3c'; ctx.fillRect(sx - 6, y - 74, 12, 74);
      ctx.fillStyle = '#6fb87f';
      ctx.beginPath(); ctx.arc(sx, y - 96, 40, 0, 6.3); ctx.fill();
      ctx.beginPath(); ctx.arc(sx - 30, y - 76, 26, 0, 6.3); ctx.fill();
      ctx.beginPath(); ctx.arc(sx + 30, y - 76, 26, 0, 6.3); ctx.fill();
    } else {
      ctx.fillStyle = i % 2 ? '#f2a0b4' : '#f7c948';
      ctx.beginPath(); ctx.arc(sx, y - 12, 7, 0, 6.3); ctx.fill();
    }
  }
}

function drawStarShape(x, y, r, col) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 ? r * 0.45 : r;
    const a = -Math.PI / 2 + i * Math.PI / 5;
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = col || '#f7c948'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 3; ctx.stroke();
}

function drawStars() {
  for (const s of stars) {
    if (s.taken) continue;
    const sx = s.wx - cam.x;
    if (sx < -80 || sx > W + 80) continue;
    const sy = terrainY(s.wx) - cam.y - 78 + Math.sin(time * 3 + s.ph) * 6;
    ctx.save(); ctx.translate(sx, sy);
    ctx.rotate(Math.sin(time * 1.6 + s.ph) * 0.15);
    drawStarShape(0, 0, 20);
    ctx.restore();
  }
}

function drawCar() {
  const sx = car.x - cam.x;
  const sy = terrainY(car.x) - cam.y;
  ctx.save();
  const bob = Math.sin(time * 16) * Math.min(1.6, Math.abs(car.v) / 260);
  ctx.translate(sx, sy - 2 + bob);
  // skugga
  ctx.fillStyle = 'rgba(0,0,0,.18)';
  ctx.beginPath(); ctx.ellipse(0, 4, 74 + (krasch ? 10 : 0), 12, 0, 0, 6.3); ctx.fill();

  // lutning = backens vinkel + hur bilen viker sig, eller vältan runt bakre/främre hjulet
  ctx.rotate(car.angle * (krasch ? 0.25 : 0.9));
  if (krasch) {
    const kspin = flipSpin(krasch.t, krasch.dir);
    // vrid runt bilens mitt och lyft så att taket vilar på marken när den ligger upp och ner
    const lift = 12 * Math.sin(Math.min(1, Math.abs(kspin) / Math.PI) * Math.PI);
    ctx.translate(0, -lift);
    ctx.translate(0, -45);
    ctx.rotate(kspin);
    ctx.translate(0, 45);
  } else {
    ctx.rotate(pitch);
  }

  // kaross
  ctx.fillStyle = '#ef8064';
  roundRect(-62, -54, 124, 46, 14); ctx.fill();
  ctx.fillStyle = '#f7a58d';
  roundRect(-58, -50, 116, 18, 10); ctx.fill();
  // hytt
  ctx.fillStyle = '#ef8064';
  roundRect(-34, -86, 74, 40, 14); ctx.fill();
  ctx.fillStyle = '#cfe9f6';
  roundRect(-26, -80, 56, 26, 9); ctx.fill();
  // Kotten kör
  if (window.KOTTEN) KOTTEN.drawAtFeet(ctx, 14, -48, 32, { wave: 0.55 });
  // lampa
  ctx.fillStyle = '#ffe08a';
  ctx.beginPath(); ctx.arc(58, -36, 7, 0, 6.3); ctx.fill();

  // hjul
  for (const wx of [-36, 38]) {
    ctx.save(); ctx.translate(wx, -6); ctx.rotate(car.wheel);
    ctx.fillStyle = '#3b3b44';
    ctx.beginPath(); ctx.arc(0, 0, 22, 0, 6.3); ctx.fill();
    ctx.fillStyle = '#d8dbe2';
    ctx.beginPath(); ctx.arc(0, 0, 10, 0, 6.3); ctx.fill();
    ctx.strokeStyle = '#9aa1ac'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-9, 0); ctx.lineTo(9, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(0, 9); ctx.stroke();
    ctx.fillStyle = '#ef8064';
    ctx.beginPath(); ctx.arc(0, -14, 3.2, 0, 6.3); ctx.fill();
    ctx.restore();
  }
  ctx.restore();

  // snurriga stjärnor och pratbubbla medan bilen ligger
  if (krasch && krasch.t > 0.45) {
    const t = krasch.t;
    const fade = t > 1.9 ? Math.max(0, (2.2 - t) / 0.3) : 1;
    ctx.save();
    ctx.globalAlpha = fade;
    for (let i = 0; i < 3; i++) {
      const a = time * 3.2 + i * 2.094;
      drawStarShape(sx + Math.cos(a) * 38, sy - 132 + Math.sin(a) * 15, 9);
    }
    ctx.fillStyle = 'rgba(255,250,243,.96)';
    roundRect(sx - 78, sy - 214, 156, 48, 20); ctx.fill();
    ctx.fillStyle = '#c9553f';
    ctx.font = 'bold 21px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('AJ AJ AJ!', sx, sy - 182);
    ctx.restore();
  }

  // accelerationspil ovanför bilen
  const slope = slopeAt(car.x);
  const theta = Math.atan(slope);
  let acc = 0;
  if (gas) acc += GAS; if (brake) acc -= BRAKE; acc += GRAV * Math.sin(theta) * 0.9;
  const show = Math.min(1, Math.abs(acc) / 240);
  if (!krasch && (gas || brake) && show > 0.12) {
    const dir = acc > 0 ? 1 : -1;
    const y = sy - 140;
    ctx.save();
    ctx.globalAlpha = 0.55 + 0.35 * show;
    ctx.fillStyle = acc > 0 ? '#2f7d63' : '#c9553f';
    ctx.beginPath();
    ctx.moveTo(sx + dir * (70 + 40 * show), y);
    const w = 26 + 26 * show;
    ctx.lineTo(sx + dir * 70, y - w * 0.55);
    ctx.lineTo(sx + dir * 70, y + w * 0.55);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = acc > 0 ? '#2f7d63' : '#c9553f';
    ctx.font = 'bold 18px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(acc > 0 ? 'ACCELERATION' : 'BROMSAR', sx, y - w * 0.9);
    ctx.restore();
  }
}

function drawDust() {
  for (const p of parts) {
    ctx.fillStyle = 'rgba(250,240,220,' + Math.max(0, p.life * 0.6) + ')';
    ctx.beginPath(); ctx.arc(p.x - cam.x, p.y - cam.y, p.r * (1.4 - p.life * 0.4), 0, 6.3); ctx.fill();
  }
}

function card(x, y, w, h) {
  ctx.fillStyle = 'rgba(0,0,0,.14)';
  roundRect(x + 3, y + 5, w, h, 18); ctx.fill();
  ctx.fillStyle = 'rgba(255,250,243,.94)';
  roundRect(x, y, w, h, 18); ctx.fill();
}

function drawHUD() {
  // HUD skalas så att den ryms både i landskap och porträtt på iPad
  const s = Math.max(0.72, Math.min(1, W / 1120));
  const VW = W / s;
  const infoZone = (0.08 * H + 0.03 * W + 12) / s; // plats för ?-knappen uppe till höger
  ctx.save();
  ctx.scale(s, s);

  // fart
  const speedW = 200;
  card(24, 20, speedW, 92);
  ctx.fillStyle = '#a08e80'; ctx.font = 'bold 12px "Trebuchet MS", sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('FART', 44, 46);
  ctx.fillStyle = '#4a3f39'; ctx.font = 'bold 40px "Trebuchet MS", sans-serif';
  ctx.fillText(Math.round(Math.abs(car.v) * 0.16) + '', 44, 88);
  ctx.font = 'bold 15px "Trebuchet MS", sans-serif';  ctx.fillStyle = '#a08e80';
  ctx.fillText('km/h', 152, 88);
  // fartbar
  const bw = 112, k = Math.min(1, Math.abs(car.v) / 880);
  ctx.fillStyle = '#eee3d6'; roundRect(112, 60, bw, 12, 6); ctx.fill();
  ctx.fillStyle = k > 0.8 ? '#ef8064' : '#63bda8'; roundRect(112, 60, Math.max(6, bw * k), 12, 6); ctx.fill();

  // stjärnor (alltid till vänster om ?-knappen)
  const starW = 212, starX = VW - infoZone - starW;
  card(starX, 20, starW, 62);
  drawStarShape(starX + 30, 51, 17);
  ctx.fillStyle = '#4a3f39'; ctx.font = 'bold 26px "Trebuchet MS", sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('× ' + score, starX + 54, 61);

  // backe – läggs i utrymmet mellan fart och stjärnor
  const deg = Math.round(Math.atan(slopeAt(car.x)) * 180 / Math.PI);
  const leftEdge = 24 + speedW + 14, rightEdge = starX - 14;
  let backeW = 220, backeX = VW / 2 - backeW / 2;
  if (backeX + backeW > rightEdge) backeX = rightEdge - backeW;
  if (backeX < leftEdge) backeX = leftEdge;
  backeW = Math.max(150, Math.min(backeW, rightEdge - backeX));
  card(backeX, 20, backeW, 62);
  const bcx = backeX + backeW / 2;
  ctx.fillStyle = '#a08e80'; ctx.font = 'bold 12px "Trebuchet MS", sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('BACKE', bcx, 42);
  ctx.fillStyle = '#4a3f39'; ctx.font = 'bold 22px "Trebuchet MS", sans-serif';
  ctx.fillText((deg > 0 ? 'nedför ' : deg < 0 ? 'uppför ' : 'platt ') + Math.abs(deg) + '°', bcx, 68);
  ctx.restore();

  // tips i början
  if (hintT < 7) {
    const a = Math.min(1, hintT) * Math.min(1, (7 - hintT) / 1.5);
    ctx.globalAlpha = Math.max(0, a);
    ctx.fillStyle = 'rgba(74,63,57,.82)';
    roundRect(W / 2 - 250, H - 132, 500, 56, 28); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 21px "Trebuchet MS", sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('Håll in GAS för att accelerera!', W / 2, H - 96);
    ctx.globalAlpha = 1;
  }

  if (celebrating > 0) {
    ctx.globalAlpha = Math.min(1, celebrating);
    ctx.fillStyle = 'rgba(255,250,243,.95)';
    roundRect(W / 2 - 190, H * 0.16, 380, 74, 26); ctx.fill();
    ctx.fillStyle = '#2f7d63'; ctx.font = 'bold 24px "Trebuchet MS", sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(score + ' stjärnor! Vad bra!', W / 2, H * 0.16 + 46);
    ctx.globalAlpha = 1;
  }
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt);
  ctx.clearRect(0, 0, W, H);
  drawSky();
  drawGround();
  drawStars();
  drawDust();
  drawCar();
  drawHUD();
  requestAnimationFrame(loop);
}

resize();
cam.x = car.x - W * 0.34;
cam.y = terrainY(car.x) - H * GROUND;
requestAnimationFrame(loop);

// testkrokar
window.__kb = {
  car: car,
  state: function () {
    return { x: car.x, v: car.v, score: score, slope: slopeAt(car.x),
             pitch: pitch, tipTime: tipTime, krasch: krasch ? { t: krasch.t, dir: krasch.dir } : null };
  },
  tip: function (dir) { startKrasch(dir || -1); },
  level: function () {
    if (!analyser) return { rms: 0, peak: 0, state: 'no-audio' };
    const buf = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(buf);
    let peak = 0, sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      peak = Math.max(peak, Math.abs(v)); sum += v * v;
    }
    return { rms: Math.sqrt(sum / buf.length), peak: peak, master: MASTER_VOL, state: actx ? actx.state : 'none' };
  },
  volume: function (v) { if (master) master.gain.value = v; },
  pose: function (t, dir) { krasch = { t: t, dir: dir || -1, said: true }; paused = true; },
  resume: function () { paused = false; krasch = null; pitch = 0; },
  press: function (k) { if (k === 'gas') setGas(true); else setBrake(true); },
  release: function (k) { if (k === 'gas') setGas(false); else setBrake(false); },
};
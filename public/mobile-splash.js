/* Phone splash (Android only, cold start). A shortened version of splash.html:
   rise from underwater (1.5 s), the shell breaks the surface, "Oceanic" fades in,
   hold 3 s, then a wave washes up over the screen and leaves Home behind.
   Styles live in mobile-splash.css. Desktop keeps splash.html. */
(() => {
  if (!/Android/i.test(navigator.userAgent)) return;
  const rand = (a, b) => a + Math.random() * (b - a);
  const wave = (cls, fill, q, flip) =>
    `<svg class="${cls}" viewBox="0 0 960 32" preserveAspectRatio="none"><path ${flip ? 'transform="matrix(1 0 0 -1 0 32)" ' : ""}d="M0 16 Q ${q} 10 ${q * 2} 16 ${Array.from({ length: 960 / (q * 2) - 1 }, (_, i) => `T ${(i + 2) * q * 2} 16`).join(" ")} V32 H0Z" fill="${fill}"/></svg>`;
  const el = document.createElement("div");
  el.id = "oc-splash";
  el.innerHTML =
    `<div class="world"><div class="sky"></div><div class="water"></div><div class="rays"></div>` +
    `<div class="ripple"></div><div class="ripple"></div><div class="ripple"></div>` +
    `<div class="rise"><img class="logo" src="/logo-shell.png" alt=""></div>` +
    wave("wv back", "#1a5ca0", 60) + wave("wv", "#0f4c8a", 40) +
    `<img class="reflect" src="/logo-shell.png" alt=""><div class="word">Oceanic</div></div>` +
    `<div class="wash">${wave("crest", "#1a6bb5", 40)}<div class="body"></div>${wave("tail", "#0b3466", 60, true)}</div>`;
  const world = el.querySelector(".world");
  const sky = el.querySelector(".sky");
  // CSSOM (not style="" attributes): the CSP allows script-set styles.
  for (let i = 0; i < 22; i++) {
    const s = document.createElement("i");
    s.className = "star";
    s.style.cssText = `left:${rand(0, 100)}%;top:${rand(4, 90)}%;--t:${rand(2, 5)}s;--dl:${rand(0, 3)}s`;
    sky.appendChild(s);
  }
  for (let i = 0; i < 18; i++) {
    const b = document.createElement("i");
    const size = rand(3, 10);
    b.className = "bub";
    b.style.cssText = `left:${rand(2, 98)}%;width:${size}px;height:${size}px;--x:${rand(-14, 14)}px;--d:${rand(4, 8)}s;--dl:${rand(-6, 0)}s`;
    world.appendChild(b);
  }
  el.querySelectorAll(".ripple").forEach((r, i) => r.style.setProperty("--dl", `${i * 0.45}s`));
  for (let i = 0; i < 9; i++) {
    const d = document.createElement("i");
    d.className = "drop";
    d.style.cssText = `--x:${rand(-50, 50)}px;--y:${rand(-40, -14)}px;--dl:${rand(0, 180)}ms`;
    world.appendChild(d);
  }
  document.body.appendChild(el);

  /* Sound, synthesized like the desktop splash: muffled rumble that opens up
     during the ascent, bubble bloops, the surfacing splash, the wave's rush. */
  const sound = (() => {
    try {
      const ctx = new AudioContext();
      const master = ctx.createGain();
      master.connect(ctx.destination);
      const tone = (at, f0, f1, dur, vol) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.setValueAtTime(f0, at);
        o.frequency.exponentialRampToValueAtTime(f1, at + dur * 0.6);
        g.gain.setValueAtTime(0, at);
        g.gain.linearRampToValueAtTime(vol, at + 0.008);
        g.gain.exponentialRampToValueAtTime(0.001, at + dur);
        o.connect(g).connect(master);
        o.start(at);
        o.stop(at + dur + 0.02);
      };
      const noise = (secs, brown) => {
        const buf = ctx.createBuffer(1, ctx.sampleRate * secs, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0, last = 0; i < d.length; i++) {
          const w = Math.random() * 2 - 1;
          d[i] = brown ? (last = (last + 0.02 * w) / 1.02) * 3.5 : w;
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        return src;
      };
      const lowpass = (points) => {
        const f = ctx.createBiquadFilter();
        f.type = "lowpass";
        points.forEach(([hz, at], i) => (i ? f.frequency.exponentialRampToValueAtTime(hz, at) : f.frequency.setValueAtTime(hz, at)));
        return f;
      };
      return {
        start() {
          ctx.resume();
          const t0 = ctx.currentTime;
          const amb = noise(4, true);
          amb.loop = true;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0, t0);
          g.gain.linearRampToValueAtTime(0.35, t0 + 0.5);
          g.gain.linearRampToValueAtTime(0.12, t0 + 3);
          amb.connect(lowpass([[260, t0], [1100, t0 + 1.6]])).connect(g).connect(master);
          amb.start();
          for (let t = 0.1; t < 1.5; t += 0.1 + Math.random() * 0.25) {
            const f = 300 + Math.random() * 500;
            tone(t0 + t, f, f * 2.2, 0.09, 0.05 + Math.random() * 0.08);
          }
        },
        splash() {
          const at = ctx.currentTime;
          tone(at, 110, 360, 0.22, 0.35);
          tone(at + 0.03, 60, 45, 0.25, 0.18);
          for (let i = 0, t = at + 0.25; i < 7; i++, t += 0.08 + Math.random() * 0.22) {
            const f = 900 + Math.random() * 900;
            tone(t, f, f * 1.8, 0.07, 0.09 * (1 - i / 9));
          }
        },
        wash() {
          const at = ctx.currentTime;
          const src = noise(1.8);
          const g = ctx.createGain();
          g.gain.setValueAtTime(0, at);
          g.gain.linearRampToValueAtTime(0.3, at + 0.6);
          g.gain.exponentialRampToValueAtTime(0.001, at + 1.75);
          src.connect(lowpass([[400, at], [2400, at + 0.7], [300, at + 1.7]])).connect(g).connect(master);
          src.start(at);
          master.gain.setTargetAtTime(0, at + 1.2, 0.3);
          setTimeout(() => ctx.close(), 2600);
        },
      };
    } catch {
      return { start() {}, splash() {}, wash() {} };
    }
  })();

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Play from when the app is shown (Rust adds .oc-reveal), not page load: on a
  // cold start the window stays dark for a while and the rise would pass unseen.
  let started = false;
  const play = () => {
    if (started) return;
    started = true;
    if (reduced) {
      el.classList.add("go", "up");
      return setTimeout(() => el.remove(), 1500);
    }
    const RISE = 1500, SURFACE = 2000, HOLD = 3000;
    el.classList.add("go");
    sound.start();
    setTimeout(() => (el.classList.add("up"), sound.splash()), RISE);
    setTimeout(() => (el.classList.add("wash-go"), sound.wash()), RISE + SURFACE + HOLD);
    setTimeout(() => el.remove(), RISE + SURFACE + HOLD + 1700);
  };
  const root = document.documentElement;
  if (root.classList.contains("oc-reveal")) play();
  else new MutationObserver((_, o) => root.classList.contains("oc-reveal") && (o.disconnect(), play())).observe(root, { attributes: true });
  setTimeout(play, 5000);
})();

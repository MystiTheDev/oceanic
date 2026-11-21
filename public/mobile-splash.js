/* Phone splash (Android only, cold start): "calm horizon", about 4.5 s.
   The Home banner's sky (dawn / day / dusk / night by the clock) and layered waves;
   the shell floats up onto the waterline, "Oceanic" fades in, a short hold, then the
   scene shrinks up into the Home banner. Styles live in mobile-splash.css.
   Desktop keeps splash.html. */
(() => {
  if (!/Android/i.test(navigator.userAgent)) return;
  const h = new Date().getHours();
  // Same hours and colours as the Home banner (src/mobile/mobile.css).
  const tod = h >= 5 && h < 8 ? "dawn" : h >= 8 && h < 17 ? "day" : h >= 17 && h < 20 ? "dusk" : "night";
  const wave = (cls, d) => `<svg class="${cls}" viewBox="0 0 400 140" preserveAspectRatio="none" aria-hidden="true"><path d="${d}"/></svg>`;
  const el = document.createElement("div");
  el.id = "oc-splash";
  el.className = `ocs-${tod}`;
  el.innerHTML =
    `<div class="scene"><div class="sky"></div><div class="sun"></div><div class="stars"></div>` +
    `<div class="sea">` +
    wave("w1", "M-100 64 C-30 40 30 100 100 70 C170 40 230 100 300 70 S430 40 500 64 V140 H-100Z") +
    wave("w2", "M-100 88 C-20 66 50 118 120 92 S240 66 320 90 S440 118 500 88 V140 H-100Z") +
    `<div class="float"><img class="logo" src="/logo-shell.png" alt=""></div>` +
    wave("w3", "M-100 110 C-10 96 60 130 140 112 S250 96 340 114 S450 128 500 110 V140 H-100Z") +
    `<div class="deep"></div><div class="word">Oceanic</div></div></div>`;
  if (tod === "night") {
    const stars = el.querySelector(".stars");
    for (let i = 0; i < 18; i++) {
      const s = document.createElement("i");
      // CSSOM (not style="" attributes): the CSP allows script-set styles.
      s.style.cssText = `left:${Math.random() * 100}%;top:${Math.random() * 90}%;animation-delay:${Math.random() * 3}s`;
      stars.appendChild(s);
    }
  }
  document.body.appendChild(el);

  /* Sound, quieter than before: soft surf, a light splash as the shell surfaces, a swell on exit. */
  const sound = (() => {
    try {
      const ctx = new AudioContext();
      const master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      const surf = (at, secs, peak, from, to) => {
        const buf = ctx.createBuffer(1, ctx.sampleRate * secs, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0, last = 0; i < d.length; i++) d[i] = (last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02) * 3.5;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const f = ctx.createBiquadFilter();
        f.type = "lowpass";
        f.frequency.setValueAtTime(from, at);
        f.frequency.exponentialRampToValueAtTime(to, at + secs * 0.5);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, at);
        g.gain.linearRampToValueAtTime(peak, at + secs * 0.4);
        g.gain.linearRampToValueAtTime(0, at + secs);
        src.connect(f).connect(g).connect(master);
        src.start(at);
      };
      const drip = (at, f0, vol) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.setValueAtTime(f0, at);
        o.frequency.exponentialRampToValueAtTime(f0 * 2, at + 0.06);
        g.gain.setValueAtTime(0, at);
        g.gain.linearRampToValueAtTime(vol, at + 0.008);
        g.gain.exponentialRampToValueAtTime(0.001, at + 0.12);
        o.connect(g).connect(master);
        o.start(at);
        o.stop(at + 0.15);
      };
      return {
        start() {
          ctx.resume();
          surf(ctx.currentTime, 4.4, 0.18, 500, 900);
        },
        splash() {
          const at = ctx.currentTime;
          for (let i = 0, t = at; i < 5; i++, t += 0.07 + Math.random() * 0.12) drip(t, 700 + Math.random() * 700, 0.05);
        },
        swell() {
          surf(ctx.currentTime, 1.2, 0.14, 300, 1400);
          setTimeout(() => ctx.close(), 1800);
        },
      };
    } catch {
      return { start() {}, splash() {}, swell() {} };
    }
  })();

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Play from when the app is shown (Rust adds .oc-reveal), not page load: on a
  // cold start the window stays dark for a while and the start would pass unseen.
  let started = false;
  const play = () => {
    if (started) return;
    started = true;
    if (reduced) {
      el.classList.add("in", "up", "word-in");
      return setTimeout(() => el.remove(), 1500);
    }
    // Sky 0.5 s, shell floats 1.2 s, word 0.8 s, hold 1.5 s, shrink into the banner 0.7 s.
    el.classList.add("in");
    sound.start();
    setTimeout(() => el.classList.add("up"), 500);
    setTimeout(() => sound.splash(), 1300);
    setTimeout(() => el.classList.add("word-in"), 1700);
    setTimeout(() => (el.classList.add("out"), sound.swell()), 4000);
    setTimeout(() => el.remove(), 4800);
  };
  const root = document.documentElement;
  if (root.classList.contains("oc-reveal")) play();
  else new MutationObserver((_, o) => root.classList.contains("oc-reveal") && (o.disconnect(), play())).observe(root, { attributes: true });
  setTimeout(play, 5000);
})();

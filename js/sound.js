/*
 * CLUBS - sound effects, made live with the Web Audio API (no audio files, so it works straight from file://).
 *   phip     a short card flick: a safe zone is issued to a scorecard
 *   slide    the same swish at half the length: a card slides onto the felt
 *   shhhuuu  a longer swish: the pile of cards slides to the winner
 * Each effect is a small "recipe" built from filtered noise. Edit the numbers in RECIPES to change how it sounds.
 * Sounds follow the Sound Effects switch in Settings. Browsers keep audio locked until the player has tapped or
 * clicked something once; until then the effects are simply skipped.
 */
(function (root) {
  'use strict';
  const Sound = { suppressed: false };
  let ctx = null;
  let master = null;
  const noiseBuffers = new WeakMap();

  function noiseSource(c) {
    let buf = noiseBuffers.get(c);
    if (!buf) {
      buf = c.createBuffer(1, c.sampleRate, c.sampleRate); // one second of white noise, reused
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      noiseBuffers.set(c, buf);
    }
    const s = c.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    return s;
  }

  // A gain node that follows a list of [time, level] points (levels ramp exponentially, so they must be > 0).
  function envelope(c, out, t, points) {
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    points.forEach((p) => g.gain.exponentialRampToValueAtTime(Math.max(p[1], 0.0001), t + p[0]));
    g.connect(out);
    return g;
  }

  // The "shhhuuu" swish. `k` stretches it in time (1 = full length, 0.5 = half); `pitch` scales the filter.
  function swish(c, out, t, k, pitch) {
    const n = noiseSource(c);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(1500 * pitch, t);
    bp.frequency.exponentialRampToValueAtTime(3000 * pitch, t + 0.2 * k);
    bp.frequency.exponentialRampToValueAtTime(650 * pitch, t + 0.6 * k);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 6500;
    n.connect(bp);
    bp.connect(lp);
    lp.connect(envelope(c, out, t, [[0.06 * k, 0.5], [0.16 * k, 1], [0.35 * k, 0.55], [0.65 * k, 0.0001]]));
    n.start(t, Math.random() * 0.3);
    n.stop(t + 0.7 * k);
  }

  const RECIPES = {
    // Card flick: a sharp, bright click with a tiny pitched "tick" under it. About 70 ms.
    phip(c, out, t) {
      const n = noiseSource(c);
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 3400;
      bp.Q.value = 1.8;
      n.connect(bp);
      bp.connect(envelope(c, out, t, [[0.003, 1], [0.025, 0.35], [0.07, 0.0001]]));
      n.start(t, Math.random() * 0.5);
      n.stop(t + 0.1);

      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(1900, t);
      o.frequency.exponentialRampToValueAtTime(650, t + 0.045);
      o.connect(envelope(c, out, t, [[0.002, 0.28], [0.05, 0.0001]]));
      o.start(t);
      o.stop(t + 0.07);
    },

    // Pile sweeping to the winner: a soft "shh" that rises, then falls away into an "uuu". About 650 ms.
    shhhuuu(c, out, t) {
      swish(c, out, t, 1, 1);
    },

    // A card sliding onto the felt: the same swish at half the length, with a little random pitch variation
    // so four cards in a row do not sound identical. About 325 ms.
    slide(c, out, t) {
      swish(c, out, t, 0.5, 0.94 + Math.random() * 0.12);
    },
  };
  Sound.recipes = RECIPES;
  Sound.LEVEL = 0.9; // overall loudness, 0 to 1
  Sound.TRIM = { phip: 1.6, slide: 1.1, shhhuuu: 1.1 }; // balances the three effects against each other

  // Start one effect through its own trim gain.
  function start(name, c, out, t) {
    const g = c.createGain();
    g.gain.value = Sound.TRIM[name] || 1;
    g.connect(out);
    RECIPES[name](c, g, t);
  }

  function context() {
    if (ctx) return ctx;
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = Sound.LEVEL;
      master.connect(ctx.destination);
    } catch (e) {
      ctx = null;
    }
    return ctx;
  }

  function wanted() {
    const S = root.ClubsSettings;
    return !Sound.suppressed && (!S || S.get().sound !== false);
  }

  // Called on the first tap / click / key press, which is when the browser allows audio to start.
  Sound.unlock = function () {
    const c = context();
    if (c && c.state === 'suspended') c.resume().catch(() => {});
  };

  Sound.play = function (name) {
    if (!wanted() || !RECIPES[name]) return;
    const c = context();
    if (!c) return;
    if (c.state !== 'running') {
      c.resume().catch(() => {}); // still locked: skip this one rather than let sounds pile up and fire together
      return;
    }
    start(name, c, master, c.currentTime + 0.005);
  };

  // Render one effect to samples (used by the tests and to make preview files). Resolves to a Float32Array.
  Sound.render = function (name, sampleRate) {
    const rate = sampleRate || 44100;
    const OAC = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    const c = new OAC(1, Math.round(rate * 1.0), rate);
    const g = c.createGain();
    g.gain.value = Sound.LEVEL;
    g.connect(c.destination);
    start(name, c, g, 0.005);
    return c.startRendering().then((buf) => buf.getChannelData(0));
  };

  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, Sound.unlock, { capture: true, passive: true }));
  root.ClubsSound = Sound;
})(window);

/*
 * CLUBS - player settings (Settings dialog). Plain data plus a change callback; no DOM.
 *   confirmBooks  true = show the "book won" dialog after every book, false = skip it
 *   sound         true = play the sound effects (js/sound.js)
 *   hardMode      false = Medium opponents, 4 rounds; true = Hard opponents, 8 rounds (see R.LEVELS)
 *   level         read-only, derived from hardMode: the R.LEVELS id (1 Medium, 2 Hard) that the engine uses
 * Saved in localStorage when the browser allows it, and works fine without it.
 */
(function (root) {
  'use strict';
  const R = root.ClubsRules;
  const KEY = 'clubs.settings.v1';
  const state = { confirmBooks: true, sound: true, hardMode: false };
  const listeners = [];

  try {
    const saved = JSON.parse(root.localStorage.getItem(KEY) || 'null');
    if (saved && typeof saved.confirmBooks === 'boolean') state.confirmBooks = saved.confirmBooks;
    if (saved && typeof saved.sound === 'boolean') state.sound = saved.sound;
    if (saved && typeof saved.hardMode === 'boolean') state.hardMode = saved.hardMode;
    else if (saved && saved.level === 3) state.hardMode = true; // from the old Easy / Medium / Hard slider: only Hard stays hard
  } catch (e) { /* private window or blocked storage: just use the defaults */ }

  const Settings = {
    get: () => Object.assign({}, state, { level: R.levelFor(state.hardMode).id }),
    rounds: () => R.levelFor(state.hardMode).rounds,
    set(patch) {
      if (typeof patch.confirmBooks === 'boolean') state.confirmBooks = patch.confirmBooks;
      if (typeof patch.sound === 'boolean') state.sound = patch.sound;
      if (typeof patch.hardMode === 'boolean') state.hardMode = patch.hardMode;
      try { root.localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
      listeners.forEach((fn) => fn(Settings.get()));
    },
    onChange(fn) { listeners.push(fn); },
  };
  root.ClubsSettings = Settings;
})(window);

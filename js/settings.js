/*
 * CLUBS - player settings (Settings dialog). Plain data plus a change callback; no DOM.
 *   confirmBooks  true = show the "book won" dialog after every book, false = skip it
 *   sound         true = play the sound effects (js/sound.js)
 *   level         1 Easy, 2 Medium, 3 Hard (see R.LEVELS); also decides the number of rounds in a game (4, 8 or 12)
 * Saved in localStorage when the browser allows it, and works fine without it.
 */
(function (root) {
  'use strict';
  const R = root.ClubsRules;
  const KEY = 'clubs.settings.v1';
  const state = { confirmBooks: true, sound: true, level: R.DEFAULT_LEVEL };
  const listeners = [];

  try {
    const saved = JSON.parse(root.localStorage.getItem(KEY) || 'null');
    if (saved && typeof saved.confirmBooks === 'boolean') state.confirmBooks = saved.confirmBooks;
    if (saved && typeof saved.sound === 'boolean') state.sound = saved.sound;
    if (saved && R.LEVELS.some((l) => l.id === saved.level)) state.level = saved.level;
  } catch (e) { /* private window or blocked storage: just use the defaults */ }

  const Settings = {
    get: () => Object.assign({}, state),
    rounds: () => R.levelInfo(state.level).rounds,
    set(patch) {
      if (typeof patch.confirmBooks === 'boolean') state.confirmBooks = patch.confirmBooks;
      if (typeof patch.sound === 'boolean') state.sound = patch.sound;
      if (R.LEVELS.some((l) => l.id === patch.level)) state.level = patch.level;
      try { root.localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
      listeners.forEach((fn) => fn(Settings.get()));
    },
    onChange(fn) { listeners.push(fn); },
  };
  root.ClubsSettings = Settings;
})(window);

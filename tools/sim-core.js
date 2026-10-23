/*
 * Shared self-play helper for the Clubs tools. Plays full games with the real engine and AI and reports
 * every player-round: { zone, clubs, points, kind, seat, round }.
 */
'use strict';
const R = require('../js/rules.js');
const E = require('../js/engine.js');

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function playGame(seed, onRound) {
  const g = E.createGame({ rng: makeRng(seed) });
  while (g.state.phase !== 'game-over') {
    g.startRound();
    while (g.state.phase === 'playing') {
      while (g.state.phase === 'playing' && g.state.book.length < 4) {
        const seat = g.state.turn;
        g.play(seat, g.aiPick(seat).id);
      }
      g.completeBook();
    }
    const r = g.finishRound();
    if (onRound) R.SEATS.forEach((seat) => onRound({ zone: r.zones[seat], clubs: r.clubs[seat], points: r.points[seat], kind: r.kinds[seat], seat: seat, round: g.state.roundIndex }));
  }
  return g.state;
}

module.exports = { makeRng, playGame };

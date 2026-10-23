/*
 * Plays many full games with the AI and reports how the assigned safe zones behave.
 * Usage: node tools/simulate.js [--games 6000]
 */
'use strict';
const R = require('../js/rules.js');
const { playGame } = require('./sim-core.js');

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = Number(process.argv[i + 1]);
const GAMES = args.games || 6000;
const pct = (x) => (100 * x).toFixed(1) + '%';

const slots = {}; // 'none' | 0 | 1 | 2 -> { n, points, hit }
const finals = [];
const seatWin = { dealer: 0, west: 0, north: 0, east: 0 };
let tie = 0, gap = 0, above = 0, rounds = 0, clubSum = 0, zeroClubs = 0;
for (let g = 0; g < GAMES; g++) {
  const st = playGame(1e5 + g, (r) => {
    const key = r.zone === null ? 'none' : r.zone;
    const c = (slots[key] = slots[key] || { n: 0, points: 0, hit: 0 });
    c.n++; c.points += r.points; if (r.kind === 'bonus') c.hit++;
    rounds++; clubSum += r.clubs; if (r.clubs === 0) zeroClubs++;
  });
  const ranked = R.rankPlayers(st.gamePoints);
  const top = ranked.filter((x) => x.place === 1);
  if (top.length > 1) tie++;
  top.forEach((t) => (seatWin[t.seat] += 1 / top.length));
  gap += ranked[0].points - ranked[3].points;
  R.SEATS.forEach((s) => { finals.push(st.gamePoints[s]); if (st.gamePoints[s] > R.START_POINTS) above++; });
}
const avg = finals.reduce((a, b) => a + b, 0) / finals.length;
const sd = Math.sqrt(finals.reduce((a, b) => a + (b - avg) ** 2, 0) / finals.length);
console.log(GAMES + ' games');
console.log('average points per round by slot:');
[[0, '0-2'], [1, '3-4'], [2, '5-6'], ['none', 'no zone']].forEach(([k, label]) => {
  const c = slots[k];
  console.log('  ' + label.padEnd(8) + (c.points / c.n).toFixed(2).padStart(6) + (k === 'none' ? '' : '   hit ' + pct(c.hit / c.n)));
});
console.log('clubs won per player-round ' + (clubSum / rounds).toFixed(2) + ', rounds with no clubs ' + pct(zeroClubs / rounds));
console.log('average final ' + avg.toFixed(1) + ' (sd ' + sd.toFixed(1) + '), first-to-last gap ' + (gap / GAMES).toFixed(1) + ', tie for 1st ' + pct(tie / GAMES) + ', players above ' + R.START_POINTS + ': ' + pct(above / finals.length));
console.log('share of wins by seat: ' + Object.keys(seatWin).map((k) => k + ' ' + pct(seatWin[k] / GAMES)).join(', '));

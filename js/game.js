/*
 * CLUBS - game flow: connects the engine (rules) to the UI (animations and dialogs).
 * Every game the four players get new random names (js/names.js). Each round: safe zones are issued (they rotate one seat clockwise per round), then seven books are played.
 *
 * Dev switches (URL query string), handy for testing:
 *   ?seed=123   reproducible shuffles
 *   ?fast=1     run the animations and delays ~20x faster
 *   ?auto=1     the dealer is played by the AI and dialogs confirm themselves (stops at the final scoreboard)
 */
(function () {
  'use strict';
  const R = window.ClubsRules;
  const E = window.ClubsEngine;
  const UI = window.ClubsUI;
  const N = window.ClubsNames;
  const Settings = window.ClubsSettings;

  const params = new URLSearchParams(window.location.search);
  const AUTO = params.get('auto') === '1';
  if (params.get('fast') === '1') {
    UI.timeScale = 0.05;
    if (window.ClubsSound) window.ClubsSound.suppressed = true; // no sound in the sped-up test mode
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rng = params.get('seed') ? mulberry32(parseInt(params.get('seed'), 10) || 1) : Math.random;

  const MSG_WAIT = 'Please wait for your turn.';
  const MSG_FOLLOW = 'The leading suit must be followed.';

  let game = null;
  let pendingHuman = null; // { legal:Set, resolve } while it is the dealer's turn

  /* ---------- the dealer's taps ---------- */

  function onHandClick(card, el) {
    if (!pendingHuman) return UI.tooltip(MSG_WAIT, el);
    if (!pendingHuman.legal.has(card.id)) return UI.tooltip(MSG_FOLLOW, el);
    const p = pendingHuman;
    pendingHuman = null;
    p.resolve({ card: card, el: el });
  }

  async function dealerTurn() {
    const legalCards = game.legalCards('dealer');
    UI.markHand(new Set(legalCards.map((c) => c.id)));

    const choice = await new Promise((resolve) => {
      pendingHuman = { legal: new Set(legalCards.map((c) => c.id)), resolve: resolve };
      if (AUTO) {
        const card = game.aiPick('dealer');
        setTimeout(() => onHandClick(card, document.querySelector('.hand-card[data-id="' + card.id + '"]')), 250 * UI.timeScale);
      }
    });

    const rect = choice.el.getBoundingClientRect();
    UI.markHand(null);
    UI.removeHandCard(choice.card.id);
    const out = game.play('dealer', choice.card.id);
    await UI.placeCard('dealer', choice.card, rect);
    return out;
  }

  async function opponentTurn(seat) {
    await UI.sleep(650 + Math.random() * 350); // a moment of "thinking"
    const card = game.aiPick(seat);
    const out = game.play(seat, card.id);
    await UI.placeCard(seat, card);
    return out;
  }

  /* ---------- one book (trick) ---------- */

  async function playBook() {
    let last = null;
    for (let i = 0; i < R.SEATS.length; i++) {
      const seat = game.state.turn;
      UI.setActive(seat);
      UI.markHand(null);
      last = seat === 'dealer' ? await dealerTurn() : await opponentTurn(seat);
    }
    UI.setActive(null);
    UI.markWinner(last.result.winningCard.id); // the winning card gets .is-winner until the book is collected

    await UI.sleep(1000); // 1s after the fourth card, then the confirmation dialog
    if (Settings.get().confirmBooks) {
      const dialog = UI.showBookDialog(last.message.title, last.message.text);
      if (AUTO) setTimeout(() => document.getElementById('book-continue').click(), 250 * UI.timeScale + 5);
      await dialog;
      await UI.sleep(500); // 0.5s after Continue, then the cards gather and slide to the winner
    } else {
      await UI.sleep(900); // Book Confirmation is off: a short look at the cards, then they slide to the winner
    }
    const done = game.completeBook();
    await UI.collectBook(done.winner);
    UI.setWon(done.winner, game.state.clubsWon[done.winner], true);
    return done;
  }

  /* ---------- one round ---------- */

  /* ---------- safe zones ---------- */

  // Two short status lines about the dealer's own zone, e.g. "Your zone: 0-2" / "Pays +10 to +20".
  function zoneLine() {
    const z = game.state.zones.dealer;
    if (z === null) return 'No safe zone\n\u2212' + R.CLUB_POINTS + ' per club won';
    const info = R.zoneOf(z);
    const pays = info.zeroReward ? '+' + info.reward + ' to +' + info.zeroReward : '+' + info.reward; // "+10 to +20" for 0-2
    return 'Your zone: ' + R.zoneLabel(z) + '\nPays ' + pays;
  }

  // "Ida", "Ida and Ike", "Ida, Ike and Camille"
  function joinNames(names) {
    return names.length < 2 ? names.join('') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  }

  // Zones are issued, not chosen: reveal them on the scorecards one seat at a time, clockwise from the dealer.
  async function zonePhase() {
    const s = game.state;
    const round = 'Round ' + (s.roundIndex + 1) + ' of ' + s.totalRounds;
    for (const seat of R.SEATS) {
      UI.setActive(seat);
      UI.setStatus({ round: round, lead: 'Issuing safe zones', zone: R.SEAT_NAME[seat] + ': ' + (s.zones[seat] === null ? 'no zone' : R.zoneLabel(s.zones[seat])) });
      UI.setZone(seat, s.zones[seat], true);
      await UI.sleep(450);
    }
    UI.setActive(null);
    UI.setStatus({ round: round, zone: zoneLine() });
    await UI.sleep(1300);
  }

  /* ---------- one round ---------- */

  async function playRound() {
    game.startRound();
    const s = game.state;
    UI.clearBoard();
    UI.clearZones();
    UI.renderHand(s.hands.dealer);
    UI.markHand(null);
    UI.setStatus({ round: 'Round ' + (s.roundIndex + 1) + ' of ' + s.totalRounds, lead: 'Dealing\u2026' });
    await UI.sleep(600);

    await zonePhase();

    while (game.state.phase === 'playing') {
      const leaderName = R.SEAT_NAME[game.state.leader];
      UI.setStatus({
        round: 'Round ' + (s.roundIndex + 1) + ' of ' + s.totalRounds,
        book: 'Book ' + (s.bookNumber + 1) + ' of ' + R.BOOKS_PER_ROUND,
        lead: leaderName + ' leads',
        zone: zoneLine(),
      });
      await playBook();
    }

    const fin = game.finishRound();
    // Show what the round produced first; any player who reached 0 or 200 then bounces back to 100.
    R.SEATS.forEach((seat) => UI.setScore(seat, 'game', fin.before[seat], true));
    await UI.sleep(700);
    const bounced = R.SEATS.filter((seat) => fin.bounces[seat]);
    if (bounced.length) {
      await UI.sleep(500);
      bounced.forEach((seat) => UI.setScore(seat, 'game', s.gamePoints[seat], true));
      await UI.sleep(700);
    }

    const hit = R.SEATS.filter((seat) => fin.kinds[seat] === 'bonus').map((seat) => R.SEAT_NAME[seat]);
    let note = hit.length ? 'Inside their zone: ' + joinNames(hit) + '.' : 'Nobody finished inside their zone.';
    const low = R.SEATS.filter((seat) => fin.bounces[seat] === 'low').map((seat) => R.SEAT_NAME[seat]);
    const high = R.SEATS.filter((seat) => fin.bounces[seat] === 'high').map((seat) => R.SEAT_NAME[seat]);
    if (low.length) note += ' ' + joinNames(low) + ' hit ' + R.CAP_LOW + ' and bounce' + (low.length > 1 ? '' : 's') + ' back to ' + R.START_POINTS + '.';
    if (high.length) note += ' ' + joinNames(high) + ' reached ' + R.CAP_HIGH + ' and ' + (high.length > 1 ? 'drop' : 'drops') + ' back to ' + R.START_POINTS + '.';

    const summary = UI.showRoundSummary({
      round: s.roundIndex + 1,
      rows: R.SEATS.map((seat) => ({
        name: R.SEAT_NAME[seat],
        zone: R.zoneLabel(fin.zones[seat]),
        won: fin.clubs[seat],
        pointsText: fmtPoints(fin.points[seat]),
        kind: fin.kinds[seat],
        total: s.gamePoints[seat],
        bounce: fin.bounces[seat],
      })),
      note: note,
      button: fin.gameOver ? 'See Final Scores' : 'Start Round ' + (s.roundIndex + 2),
    });
    if (AUTO) setTimeout(() => document.getElementById('modal-continue').click(), 250 * UI.timeScale + 5);
    await summary;
    return fin;
  }

  /* ---------- whole game ---------- */

  // +1 / 0 / -3 with a proper minus sign.
  function fmtPoints(p) {
    return p > 0 ? '+' + p : p < 0 ? '\u2212' + Math.abs(p) : '0';
  }

  function finalScoreboardData() {
    const s = game.state;
    const ranked = R.rankPlayers(s.gamePoints);
    // Up to 4 rounds: one column per round. Longer games (8 rounds, Hard Mode) show one column per 4-round game.
    const grouped = s.history.length > R.ROUNDS;
    const cols = grouped ? s.history.length / R.ROUNDS : s.history.length;
    const columns = [];
    for (let i = 0; i < cols; i++) columns.push(grouped ? 'G' + (i + 1) : 'R' + (i + 1));
    const perRound = (seat) => {
      const pts = s.history.map((h) => h.points[seat]);
      if (!grouped) return pts.map(fmtPoints);
      return columns.map((_, g) => fmtPoints(pts.slice(g * R.ROUNDS, (g + 1) * R.ROUNDS).reduce((a, b) => a + b, 0)));
    };
    const winners = ranked.filter((r) => r.place === 1);
    let headline;
    if (winners.length === 1) {
      headline = winners[0].seat === 'dealer' ? 'You win with the most points!' : R.SEAT_NAME[winners[0].seat] + ' wins with the most points.';
    } else {
      headline = joinNames(winners.map((w) => R.SEAT_NAME[w.seat])) + ' tie for first place.';
    }
    const bounced = s.history.some((h) => R.SEATS.some((seat) => h.bounces[seat]));
    return {
      headline: headline,
      note: bounced ? 'Totals include the bounce back to ' + R.START_POINTS + ' at ' + R.CAP_LOW + ' or ' + R.CAP_HIGH + ', so they can differ from the sum of the rounds.' : '',
      columns: columns,
      rows: ranked.map((r) => ({
        place: r.place,
        name: R.SEAT_NAME[r.seat],
        perRound: perRound(r.seat),
        total: r.points,
      })),
    };
  }

  async function runGame() {
    game = E.createGame({ rng: rng, level: Settings.get().level }); // rounds follow the level: 4 (Medium) or 8 (Hard Mode)
    R.setPlayerNames(N.pickNames(R.SEATS, rng)); // four new hurricane names every game; SEATS[0] is the human
    UI.setNames();
    window.__clubs = { game: game }; // for debugging / automated tests
    UI.clearZones();
    R.SEATS.forEach((seat) => UI.setScore(seat, 'game', R.START_POINTS, false));
    // Wait for a tap on Deal before the first round (it also lets the browser start audio).
    UI.setStatus({ lead: 'Tap Deal to start' });
    const dealt = UI.waitForDeal();
    if (AUTO) setTimeout(() => document.getElementById('deal-btn').click(), 50);
    await dealt;
    while (game.state.phase !== 'game-over') await playRound();

    UI.setStatus({ round: 'Game over' });
    document.body.dataset.gameOver = '1';
    const final = UI.showFinal(finalScoreboardData());
    await final;
    delete document.body.dataset.gameOver;
    return runGame();
  }

  UI.init({ onHandClick: onHandClick });
  // Turning Hard Mode on restarts the game (see ui.js). Turning it off applies to the computer players right away,
  // but the game in progress keeps its 8 rounds; 4 rounds starts with the next game.
  Settings.onChange((v) => { if (game) game.setLevel(v.level); });
  UI.settingsNote = (v) => {
    const rounds = R.levelFor(v.hardMode).rounds;
    return game && game.state.totalRounds !== rounds
      ? 'This game stays at ' + game.state.totalRounds + ' rounds. ' + rounds + ' rounds starts with the next game.'
      : '';
  };
  UI.setStatus({ lead: 'Dealing\u2026' });
  runGame().catch((err) => {
    console.error(err);
    UI.setStatus({ lead: 'Something went wrong - see the console.' });
  });
})();

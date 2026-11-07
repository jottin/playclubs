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

  // Pace of play (1 = the original speed; smaller = faster).
  const PACE = 0.8;       // the computer players' "thinking" pause before each card
  const BOOK_PAUSE = 0.6; // the pauses between the fourth card of a book and the pile sliding away 

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
    // The two hand tooltips follow the "Confirmation and Tips" setting.
    const tips = Settings.get().confirmBooks;
    if (!pendingHuman) return tips ? UI.tooltip(MSG_WAIT, el) : undefined;
    if (!pendingHuman.legal.has(card.id)) return tips ? UI.tooltip(MSG_FOLLOW, el) : undefined;
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
    await UI.sleep((650 + Math.random() * 350) * PACE); // a moment of "thinking"
    const card = game.aiPick(seat);
    const out = game.play(seat, card.id);
    UI.setOppHand(seat, game.state.hands[seat].length);
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

    await UI.sleep(1000 * BOOK_PAUSE); // after the fourth card, then the confirmation dialog
    if (Settings.get().confirmBooks) {
      const dialog = UI.showBookDialog(last.message.title, last.message.text);
      if (AUTO) setTimeout(() => document.getElementById('book-continue').click(), 250 * UI.timeScale + 5);
      await dialog;
      await UI.sleep(500 * BOOK_PAUSE); // after Continue, then the cards gather and slide to the winner
    } else {
      await UI.sleep(900 * BOOK_PAUSE); // Confirmation and Tips is off: a short look at the cards, then they slide to the winner
    }
    const done = game.completeBook();
    await UI.collectBook(done.winner);
    UI.setWon(done.winner, game.state.clubsWon[done.winner], true);
    return done;
  }

  /* ---------- rounds, games and scores on screen ---------- */

  // Games are always 4 rounds. Beginner plays one; Expert Mode plays two and adds them up.
  function gamesTotal() {
    return Math.ceil(game.state.totalRounds / R.ROUNDS);
  }
  function roundInGame() {
    return (game.state.roundIndex % R.ROUNDS) + 1;
  }
  function roundLabel() {
    return 'Round ' + roundInGame() + ' of ' + R.ROUNDS;
  }
  // Expert Mode shows "Game 1 of 2" where Beginner shows "Book 3 of 7".
  function gameLabel() {
    return gamesTotal() > 1 ? 'Game ' + (game.state.gameIndex + 1) + ' of ' + gamesTotal() : undefined;
  }
  // Scorecard score: just the game score, or in Expert Mode's second game "180+50": game 1's final score (in a <span> so it can be
  // styled on its own) + this game's score so far.
  function setGameScore(seat, value, animate) {
    const s = game.state;
    const before = gamesTotal() < 2 || s.gameIndex === 0 ? null : s.gameTotals.slice(0, s.gameIndex).reduce((sum, g) => sum + g[seat], 0);
    UI.setScore(seat, 'game', value, animate, before);
  }

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
    const round = roundLabel();
    for (const seat of R.SEATS) {
      UI.setActive(seat);
      UI.setStatus({ round: round, book: gameLabel(), lead: 'Issuing safe zones', zone: R.SEAT_NAME[seat] + ': ' + (s.zones[seat] === null ? 'no zone' : R.zoneLabel(s.zones[seat])) });
      UI.setZone(seat, s.zones[seat], true);
      await UI.sleep(450);
    }
    UI.setActive(null);
    UI.setStatus({ round: round, book: gameLabel(), zone: zoneLine() });
    await UI.sleep(1300);
  }

  /* ---------- one round ---------- */

  async function playRound() {
    game.startRound();
    const s = game.state;
    UI.clearBoard();
    UI.clearZones();
    UI.renderHand(s.hands.dealer);
    ['west', 'north', 'east'].forEach((seat) => UI.setOppHand(seat, s.hands[seat].length));
    UI.markHand(null);
    if (s.roundIndex % R.ROUNDS === 0) R.SEATS.forEach((seat) => setGameScore(seat, s.gamePoints[seat], false)); // a new game: everyone on 100
    UI.setStatus({ round: roundLabel(), book: gameLabel(), lead: 'Dealing\u2026' });
    await UI.sleep(600);

    await zonePhase();

    while (game.state.phase === 'playing') {
      const leaderName = R.SEAT_NAME[game.state.leader];
      UI.setStatus({
        round: roundLabel(),
        book: gameLabel() || 'Book ' + (s.bookNumber + 1) + ' of ' + R.BOOKS_PER_ROUND,
        lead: leaderName + ' leads',
        zone: zoneLine(),
      });
      await playBook();
    }

    const fin = game.finishRound();
    // Show what the round produced first; any player who reached 0 or 200 then bounces back to 100.
    R.SEATS.forEach((seat) => setGameScore(seat, fin.before[seat], true));
    await UI.sleep(700);
    const bounced = R.SEATS.filter((seat) => fin.bounces[seat]);
    if (bounced.length) {
      await UI.sleep(500);
      bounced.forEach((seat) => setGameScore(seat, s.gamePoints[seat], true));
      await UI.sleep(700);
    }

    // One line above the colour key: whoever scored the most points this round (ties name everyone).
    const best = Math.max.apply(null, R.SEATS.map((seat) => fin.points[seat]));
    const roundWinners = R.SEATS.filter((seat) => fin.points[seat] === best).map((seat) => R.SEAT_NAME[seat]);
    // Say why they won: the most points, nobody lost points, or everybody lost and theirs was the smallest loss.
    const why = best > 0 ? 'scoring the most points' : best === 0 ? 'not losing points' : 'losing the fewest points';
    const note = joinNames(roundWinners) + (roundWinners.length > 1 ? ' win' : ' wins') + ' the round by ' + why + '.';

    const summary = UI.showRoundSummary({
      round: roundInGame(),
      game: gamesTotal() > 1 ? fin.game + 1 : null, // Expert Mode only: the summary names the game
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
      button: fin.gameOver ? 'See Final Scores' : fin.gameComplete ? 'Start Game ' + (fin.game + 2) : 'Start Round ' + (roundInGame() + 1),
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
    const totals = game.overall(); // the finished games added up (Beginner: its one game)
    const ranked = R.rankPlayers(totals);
    const twoGames = s.gameTotals.length > 1;
    // Beginner: one column per round (points won or lost). Expert Mode: one column per game (that game's final score), added up in Total.
    const columns = twoGames ? s.gameTotals.map((_, g) => 'Game ' + (g + 1)) : s.history.map((_, i) => 'R' + (i + 1));
    // Beginner: green/red points per round, blue when that round caused a bounce. Expert: the game scores, uncoloured.
    const perRound = (seat) =>
      twoGames
        ? s.gameTotals.map((g) => ({ text: String(g[seat]), kind: '' }))
        : s.history.map((h) => ({ text: fmtPoints(h.points[seat]), kind: h.bounces[seat] ? 'bounce' : h.kinds[seat] === 'bonus' ? 'bonus' : h.kinds[seat] === 'miss' ? 'miss' : '' }));
    const winners = ranked.filter((r) => r.place === 1);
    let headline;
    if (winners.length === 1) {
      headline = winners[0].seat === 'dealer' ? 'You win with the most points!' : R.SEAT_NAME[winners[0].seat] + ' wins with the most points.';
    } else {
      headline = joinNames(winners.map((w) => R.SEAT_NAME[w.seat])) + ' tie for first place.';
    }
    return {
      headline: headline,
      note: '',
      legend: !twoGames, // the colour key belongs to the round-by-round (Beginner) scoreboard
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
    game = E.createGame({ rng: rng, level: Settings.get().level }); // games are 4 rounds: one (Beginner) or two (Expert Mode)
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
  // Changing the mode restarts the game when Settings closes (see ui.js), so nothing here has to react to it.
  UI.setStatus({ lead: 'Dealing\u2026' });
  runGame().catch((err) => {
    console.error(err);
    UI.setStatus({ lead: 'Something went wrong - see the console.' });
  });
})();

/*
 * CLUBS - game engine (state machine, no DOM, no timers).
 * The UI drives it: startRound() (safe zones are issued automatically) -> play() x4 -> completeBook() ... -> finishRound().
 * Works in the browser (window.ClubsEngine) and in Node, which is how the tests run full games.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rules.js'), require('./ai.js'));
  else root.ClubsEngine = factory(root.ClubsRules, root.ClubsAI);
})(typeof self !== 'undefined' ? self : this, function (R, AI) {
  'use strict';

  function filled(v) {
    const o = {};
    R.SEATS.forEach((s) => (o[s] = v));
    return o;
  }
  function zeroes() {
    return filled(0);
  }

  function createGame(options) {
    const opts = options || {};
    const rng = opts.rng || Math.random;
    let level = R.levelInfo(opts.level);
    // How many random legal plays each computer player makes per round (Beginner: 1). `opts.randomPlays` overrides the level (simulators).
    const randomPlaysPerRound = () => (typeof opts.randomPlays === 'number' ? opts.randomPlays : level.randomPlays || 0);

    const state = {
      roundIndex: -1,
      level: level.id,
      totalRounds: opts.rounds || level.rounds, // 4, 8 or 12 (Settings)
      // setup | playing | book-complete | round-complete | between-rounds | game-over
      phase: 'setup',
      leader: null,
      turn: null,
      zones: {}, // seat -> zone id (0, 1, 2) or null for no zone, issued at the start of each round
      hands: {},
      book: [],
      bookNumber: 0,
      clubsWon: zeroes(),
      played: [],
      gamePoints: filled(R.START_POINTS), // the score in the game being played; every 4-round game starts at 100
      gameIndex: 0, // 0 for the first 4-round game, 1 for the second (Expert Mode)
      gameTotals: [], // one { seat: score } entry for every finished game; the final result is the sum of these
      history: [], // one entry per finished round: { clubs, zones, points, kinds, before, bounces }
      lastResult: null,
      randomBooks: {}, // seat -> Set of book numbers (0-6) at which that computer player plays a random legal card this round
    };

    function startRound() {
      if (state.phase !== 'setup' && state.phase !== 'between-rounds') throw new Error('Cannot start a round now');
      state.roundIndex++;
      // A new game (every 4 rounds) starts everyone back on 100 points.
      if (state.roundIndex > 0 && state.roundIndex % R.ROUNDS === 0) state.gamePoints = filled(R.START_POINTS);
      state.gameIndex = Math.floor(state.roundIndex / R.ROUNDS);
      state.hands = R.deal(rng).hands;
      state.book = [];
      state.bookNumber = 0;
      state.clubsWon = zeroes();
      state.played = [];
      state.lastResult = null;
      state.leader = R.leaderForRound(state.roundIndex);
      state.turn = state.leader;
      // Safe zones are issued, not chosen, and the pattern rotates one seat clockwise each round.
      state.zones = R.zonesForRound(state.roundIndex);
      state.phase = 'playing';
      // Beginner: each computer player (never the human dealer seat) plays a random legal card at a few unannounced books.
      state.randomBooks = {};
      const n = Math.min(randomPlaysPerRound(), R.BOOKS_PER_ROUND);
      R.SEATS.filter((seat) => seat !== 'dealer').forEach((seat) => {
        const set = new Set();
        while (set.size < n) set.add(Math.floor(rng() * R.BOOKS_PER_ROUND));
        state.randomBooks[seat] = set;
      });
      return state;
    }

    function leadSuit() {
      return state.book.length ? state.book[0].card.suit : null;
    }

    function legalCards(seat) {
      return R.legalCards(state.hands[seat], leadSuit());
    }

    function play(seat, cardId) {
      if (state.phase !== 'playing') throw new Error('Not accepting cards right now');
      if (seat !== state.turn) throw new Error('It is not ' + seat + "'s turn");
      const hand = state.hands[seat];
      const card = hand.find((c) => c.id === cardId);
      if (!card) throw new Error(seat + ' does not hold ' + cardId);
      if (!legalCards(seat).some((c) => c.id === cardId)) throw new Error('Illegal play: the leading suit must be followed');

      hand.splice(hand.indexOf(card), 1);
      state.book.push({ seat: seat, card: card });
      state.played.push(card);

      if (state.book.length === R.SEATS.length) {
        state.lastResult = R.resolveBook(state.book);
        state.phase = 'book-complete';
        return { bookFull: true, result: state.lastResult, message: R.describeBook(state.lastResult) };
      }
      state.turn = R.nextSeat(seat);
      return { bookFull: false };
    }

    // Apply the confirmed book: the winner collects its clubs and leads next.
    function completeBook() {
      if (state.phase !== 'book-complete') throw new Error('No completed book to confirm');
      const res = state.lastResult;
      state.clubsWon[res.winner] += res.clubs;
      state.leader = res.winner;
      state.turn = state.leader;
      state.book = [];
      state.bookNumber++;
      const roundOver = R.SEATS.every((s) => state.hands[s].length === 0);
      state.phase = roundOver ? 'round-complete' : 'playing';
      return { winner: res.winner, clubsAdded: res.clubs, roundOver: roundOver };
    }

    function finishRound() {
      if (state.phase !== 'round-complete') throw new Error('Round is not finished');
      const scored = R.scoreRound(state.clubsWon, state.zones);
      const bounces = {}; // seat -> 'low' | 'high' | null: the 100-point cap rule
      const before = {}; // the total the round produced, before any bounce
      R.SEATS.forEach((s) => {
        before[s] = state.gamePoints[s] + scored.points[s];
        const c = R.applyCap(before[s]);
        state.gamePoints[s] = c.total;
        bounces[s] = c.bounce;
      });
      const entry = {
        before: before,
        bounces: bounces,
        clubs: Object.assign({}, state.clubsWon),
        zones: Object.assign({}, state.zones),
        points: scored.points,
        kinds: scored.kinds,
      };
      entry.game = state.gameIndex;
      state.history.push(entry);
      const gameOver = state.roundIndex >= state.totalRounds - 1;
      const gameComplete = gameOver || (state.roundIndex + 1) % R.ROUNDS === 0; // the last round of a 4-round game
      if (gameComplete) state.gameTotals.push(Object.assign({}, state.gamePoints));
      state.phase = gameOver ? 'game-over' : 'between-rounds';
      return Object.assign({ gameOver: gameOver, gameComplete: gameComplete, game: state.gameIndex }, entry);
    }

    // The AI plays toward its safe zone (or just avoids clubs when it has none). `extra` can override the AI context.
    function aiPick(seat, extra) {
      // A planned random play (Beginner): any legal card, chosen at random.
      const planned = state.randomBooks[seat];
      if (planned && planned.has(state.bookNumber)) {
        const legal = legalCards(seat);
        return legal[Math.floor(rng() * legal.length)];
      }
      const base = {
        hand: state.hands[seat],
        book: state.book,
        clubsWon: state.clubsWon[seat],
        played: state.played,
        rng: rng,
        mistakes: level.mistakes,
        utility: R.zoneUtility(state.zones[seat]),
      };
      const o = Object.assign({}, level, extra); // `extra` can override the level (used by the simulators)
      if (o.search) {
        // Expert: look ahead over simulated deals. All the cards in play and every player's zone are public.
        const handSizes = {};
        R.SEATS.forEach((x) => (handSizes[x] = state.hands[x].length));
        return AI.chooseCardSearch({
          mySeat: seat, hand: base.hand, book: state.book, played: state.played,
          clubsWon: state.clubsWon, zones: state.zones, handSizes: handSizes, rng: rng, samples: o.search,
        });
      }
      return AI.chooseCard(Object.assign(base, { mistakes: o.mistakes }));
    }

    // The difficulty can change mid-game (Settings); the number of rounds is fixed when the game starts.
    function setLevel(id) {
      level = R.levelInfo(id);
    }

    // The result of the whole match: the finished games' scores added up (Beginner is one game, Expert two).
    function overall() {
      const o = zeroes();
      state.gameTotals.forEach((g) => R.SEATS.forEach((seat) => (o[seat] += g[seat])));
      return o;
    }

    return { state, overall, startRound, legalCards, play, completeBook, finishRound, aiPick, setLevel };
  }

  return { createGame };
});

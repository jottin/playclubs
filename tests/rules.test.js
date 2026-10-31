'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../js/rules.js');
const AI = require('../js/ai.js');
const { createGame } = require('../js/engine.js');

// Tiny seeded RNG so failures are reproducible.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const c = (suit, rank) => R.makeCard(suit, rank);
const play = (seat, suit, rank) => ({ seat, card: c(suit, rank) });

test('deck has 52 unique cards; deal gives 7 each and sets 24 aside', () => {
  const deck = R.createDeck();
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck.map((x) => x.id)).size, 52);
  const { hands, setAside } = R.deal(mulberry32(1));
  R.SEATS.forEach((s) => assert.equal(hands[s].length, 7));
  assert.equal(setAside.length, 24);
  const all = [].concat(...R.SEATS.map((s) => hands[s]), setAside);
  assert.equal(new Set(all.map((x) => x.id)).size, 52);
});

test('Aces are high and 2s are low', () => {
  assert.equal(c('hearts', 14).label, 'A');
  assert.equal(c('hearts', 2).rank, 2);
  assert.ok(c('hearts', 14).rank > c('hearts', 13).rank);
});

test('round leaders: West, North, East, then the Dealer', () => {
  assert.deepEqual([0, 1, 2, 3].map(R.leaderForRound), ['west', 'north', 'east', 'dealer']);
  assert.equal(new Set([0, 1, 2, 3].map(R.leaderForRound)).size, 4);
});

test('turn order is clockwise: dealer -> west -> north -> east', () => {
  assert.equal(R.nextSeat('dealer'), 'west');
  assert.equal(R.nextSeat('west'), 'north');
  assert.equal(R.nextSeat('north'), 'east');
  assert.equal(R.nextSeat('east'), 'dealer');
});

test('must follow suit; clubs are only legal off-suit when the lead suit is missing', () => {
  const hand = [c('hearts', 5), c('clubs', 9), c('spades', 3)];
  assert.deepEqual(R.legalCards(hand, 'hearts').map((x) => x.id), ['H5']);
  assert.deepEqual(R.legalCards(hand, 'diamonds').length, 3); // void: anything, clubs included
  assert.deepEqual(R.legalCards(hand, 'clubs').map((x) => x.id), ['C9']); // club lead must be followed
  assert.equal(R.legalCards(hand, null).length, 3); // leading: anything
});

test('highest non-club wins even when clubs are in the book', () => {
  const r = R.resolveBook([play('west', 'hearts', 4), play('north', 'clubs', 14), play('east', 'hearts', 9), play('dealer', 'clubs', 13)]);
  assert.equal(r.winner, 'east');
  assert.equal(r.clubs, 2);
  assert.equal(r.reason, 'highest-lead-suit');
  assert.equal(R.describeBook(r).text, 'By playing the highest-ranked card of the leading suit.');
});

test('four clubs: highest club wins', () => {
  const r = R.resolveBook([play('west', 'clubs', 3), play('north', 'clubs', 12), play('east', 'clubs', 9), play('dealer', 'clubs', 5)]);
  assert.equal(r.winner, 'north');
  assert.equal(r.clubs, 4);
  assert.equal(r.reason, 'highest-club');
});

test('club-led book: the highest club wins even when non-clubs are played', () => {
  const r = R.resolveBook([play('west', 'clubs', 5), play('north', 'hearts', 14), play('east', 'clubs', 9), play('dealer', 'diamonds', 2)]);
  assert.equal(r.winner, 'east');
  assert.equal(r.reason, 'highest-club');
  assert.equal(r.clubs, 2);
  assert.equal(R.describeBook(r).text, 'By playing the highest-ranked club card.');
  // a higher non-club still cannot beat a matched club lead
  const q = R.resolveBook([play('west', 'clubs', 9), play('north', 'clubs', 5), play('east', 'spades', 14), play('dealer', 'hearts', 13)]);
  assert.equal(q.winner, 'west');
});

test('leader wins when nobody else matches or beats', () => {
  const r = R.resolveBook([play('west', 'hearts', 6), play('north', 'clubs', 14), play('east', 'clubs', 2), play('dealer', 'clubs', 8)]);
  assert.equal(r.winner, 'west');
  assert.equal(r.reason, 'uncontested-lead');
  assert.equal(R.describeBook(r).text, 'By leading a suit that no other player could match.');
});

test('lead suit unmatched: the leader wins whatever the ranks, even against higher off-suit cards', () => {
  const r = R.resolveBook([play('west', 'diamonds', 2), play('north', 'spades', 14), play('east', 'hearts', 13), play('dealer', 'clubs', 9)]);
  assert.equal(r.winner, 'west');
  assert.equal(r.reason, 'uncontested-lead');
  assert.equal(r.clubs, 1);
  // equal-ranked off-suit cards make no difference when the lead is unmatched
  const t = R.resolveBook([play('west', 'diamonds', 2), play('north', 'spades', 9), play('east', 'hearts', 9), play('dealer', 'clubs', 9)]);
  assert.equal(t.winner, 'west');
});

test('an off-suit card never wins a non-club-led book (even if higher than the matching cards)', () => {
  const r = R.resolveBook([play('west', 'hearts', 4), play('north', 'spades', 14), play('east', 'hearts', 9), play('dealer', 'clubs', 2)]);
  assert.equal(r.winner, 'east');
  assert.equal(r.clubs, 1);
  const q = R.resolveBook([play('west', 'hearts', 4), play('north', 'spades', 14), play('east', 'hearts', 9), play('dealer', 'diamonds', 13)]);
  assert.equal(q.winner, 'east');
});

test('only three winning explanations exist', () => {
  const texts = [
    R.resolveBook([play('west', 'hearts', 4), play('north', 'clubs', 14), play('east', 'hearts', 9), play('dealer', 'spades', 13)]), // lead suit
    R.resolveBook([play('west', 'hearts', 4), play('north', 'clubs', 14), play('east', 'spades', 9), play('dealer', 'spades', 13)]), // unmatched lead
    R.resolveBook([play('west', 'clubs', 4), play('north', 'clubs', 14), play('east', 'spades', 9), play('dealer', 'hearts', 13)]), // club lead
  ].map((r) => R.describeBook(r).text);
  assert.deepEqual(texts, [
    'By playing the highest-ranked card of the leading suit.',
    'By leading a suit that no other player could match.',
    'By playing the highest-ranked club card.',
  ]);
});

test('book dialog titles match the spec', () => {
  const titles = ['dealer', 'west', 'north', 'east'].map((w) =>
    R.describeBook({ winner: w, reason: 'highest-lead-suit', clubs: 0 }).title);
  assert.deepEqual(titles, ['Dealer (You) won the book!', 'Player West won the book!', 'Player North won the book!', 'Player East won the book!']);
});

test('scoring: zone rewards scale with the odds, otherwise each club costs 10', () => {
  // zone 0-2: no clubs +20, 1 or 2 clubs +10
  assert.deepEqual(R.scoreZone(0, 0), { points: 20, kind: 'bonus' });
  assert.deepEqual(R.scoreZone(1, 0), { points: 10, kind: 'bonus' });
  assert.deepEqual(R.scoreZone(2, 0), { points: 10, kind: 'bonus' });
  assert.deepEqual(R.scoreZone(3, 0), { points: -30, kind: 'miss' });
  assert.deepEqual(R.scoreZone(7, 0), { points: -70, kind: 'miss' });
  // zone 3-4: +30
  assert.deepEqual(R.scoreZone(3, 1), { points: 30, kind: 'bonus' });
  assert.deepEqual(R.scoreZone(4, 1), { points: 30, kind: 'bonus' });
  assert.deepEqual(R.scoreZone(2, 1), { points: -20, kind: 'miss' });
  assert.deepEqual(R.scoreZone(5, 1), { points: -50, kind: 'miss' });
  assert.deepEqual(R.scoreZone(0, 1), { points: 0, kind: 'free' }); // no clubs is never a loss
  // zone 5-6: +50, and 7 or more clubs misses it
  assert.deepEqual(R.scoreZone(5, 2), { points: 50, kind: 'bonus' });
  assert.deepEqual(R.scoreZone(6, 2), { points: 50, kind: 'bonus' });
  assert.deepEqual(R.scoreZone(7, 2), { points: -70, kind: 'miss' });
  assert.deepEqual(R.scoreZone(4, 2), { points: -40, kind: 'miss' });
  assert.deepEqual(R.scoreZone(0, 2), { points: 0, kind: 'free' });
  // no zone: 10 per club, not doubled, and no safety net
  assert.deepEqual(R.scoreZone(0, null), { points: 0, kind: 'free' });
  assert.deepEqual(R.scoreZone(1, null), { points: -10, kind: 'miss' });
  assert.deepEqual(R.scoreZone(6, null), { points: -60, kind: 'miss' });
  assert.equal(R.START_POINTS, 100);
  assert.equal(R.CLUB_POINTS, 10);
  assert.deepEqual(R.ZONES.map((z) => z.label), ['0-2', '3-4', '5-6']);
});

test('round scoring uses each player\'s own zone', () => {
  const s = R.scoreRound({ dealer: 2, west: 0, north: 5, east: 3 }, { dealer: null, west: 0, north: 1, east: 2 });
  assert.deepEqual(s.points, { dealer: -20, west: 20, north: -50, east: -30 });
  assert.deepEqual(s.kinds, { dealer: 'miss', west: 'bonus', north: 'miss', east: 'miss' });
});

test('zones rotate one seat clockwise each round; everyone gets each zone once and sits out once', () => {
  assert.deepEqual(R.zonesForRound(0), { dealer: null, west: 0, north: 1, east: 2 });
  assert.deepEqual(R.zonesForRound(1), { dealer: 2, west: null, north: 0, east: 1 });
  assert.deepEqual(R.zonesForRound(2), { dealer: 1, west: 2, north: null, east: 0 });
  assert.deepEqual(R.zonesForRound(3), { dealer: 0, west: 1, north: 2, east: null });
  R.SEATS.forEach((seat) => {
    const seen = [0, 1, 2, 3].map((r) => R.zonesForRound(r)[seat]).map(String).sort();
    assert.deepEqual(seen, ['0', '1', '2', 'null']);
  });
  for (let r = 0; r < 4; r++) {
    const z = Object.values(R.zonesForRound(r)).map(String).sort();
    assert.deepEqual(z, ['0', '1', '2', 'null']); // one player per zone, one with none
  }
});

test('zone utility is the cost in clubs (points / 10) under the scoring; the AI plays against it', () => {
  [null, 0, 1, 2].forEach((zone) => {
    for (let won = 0; won <= 10; won++) assert.equal(R.zoneUtility(zone)(won), -R.scoreZone(won, zone).points / 10);
  });
  assert.equal(R.zoneUtility(0)(0), -2); // the AI chases the zero-club bonus
  assert.equal(R.zoneUtility(null)(3), 3);
});

test('engine issues the zones at the start of each round; there is no bidding phase', () => {
  const g = createGame({ rng: mulberry32(3) });
  R.SEATS.forEach((s) => assert.equal(g.state.gamePoints[s], 100));
  g.startRound();
  assert.equal(g.state.phase, 'playing');
  assert.deepEqual(g.state.zones, R.zonesForRound(0));
  assert.equal(g.state.turn, 'west');
  while (g.state.phase === 'playing') {
    for (let i = 0; i < 4; i++) { const seat = g.state.turn; g.play(seat, g.aiPick(seat).id); }
    g.completeBook();
  }
  const fin = g.finishRound();
  R.SEATS.forEach((s) => assert.equal(g.state.gamePoints[s], R.applyCap(100 + fin.points[s]).total));
  assert.deepEqual(fin.zones, R.zonesForRound(0));
  g.startRound();
  assert.deepEqual(g.state.zones, R.zonesForRound(1));
});

test('final ranking: most points first, ties share a place', () => {
  const rows = R.rankPlayers({ dealer: 85, west: 110, north: 85, east: 60 });
  assert.deepEqual(rows.map((r) => [r.seat, r.place]), [['west', 1], ['dealer', 2], ['north', 2], ['east', 4]]);
});

test('AI always plays a legal card', () => {
  const rng = mulberry32(42);
  for (let i = 0; i < 300; i++) {
    const { hands } = R.deal(rng);
    const lead = ['clubs', 'hearts', 'spades', 'diamonds'][i % 4];
    const book = [{ seat: 'west', card: c(lead, 2 + (i % 12)) }];
    const hand = hands.north;
    const pick = AI.chooseCard({ hand, book, clubsWon: i % 9, played: book.map((p) => p.card), rng });
    assert.ok(R.legalCards(hand, lead).some((x) => x.id === pick.id));
  }
});

test('engine rejects illegal moves and wrong turns', () => {
  const g = createGame({ rng: mulberry32(7) });
  g.startRound();
  assert.equal(g.state.phase, 'playing');
  assert.equal(g.state.turn, 'west');
  assert.throws(() => g.play('north', g.state.hands.north[0].id), /not north's turn/);
  const west = g.state.hands.west[0];
  g.play('west', west.id);
  const north = g.state.hands.north;
  const offSuit = north.find((x) => x.suit !== west.suit);
  if (north.some((x) => x.suit === west.suit) && offSuit) {
    assert.throws(() => g.play('north', offSuit.id), /leading suit/);
  }
});

// Plays complete games with the AI in every seat and checks the bookkeeping.
{
  test('full-game simulation: 4 rounds x 7 books, cards and clubs all accounted for', () => {
    for (let seed = 1; seed <= 150; seed++) {
      const rng = mulberry32(seed);
      const g = createGame({ rng });
      const leaders = [];
      for (let round = 0; round < R.ROUNDS; round++) {
        g.startRound();
        leaders.push(g.state.leader);
        assert.equal(g.state.phase, 'playing');
        assert.deepEqual(g.state.zones, R.zonesForRound(round));
        const dealtClubs = [].concat(...R.SEATS.map((s) => g.state.hands[s])).filter((x) => x.suit === 'clubs').length;
        let books = 0;
        while (g.state.phase === 'playing') {
          for (let i = 0; i < 4; i++) {
            const seat = g.state.turn;
            const pick = g.aiPick(seat);
            const out = g.play(seat, pick.id);
            if (i === 3) assert.ok(out.bookFull);
          }
          const done = g.completeBook();
          books++;
          assert.equal(done.roundOver, books === 7);
        }
        assert.equal(books, 7);
        const sum = R.SEATS.reduce((n, s) => n + g.state.clubsWon[s], 0);
        assert.equal(sum, dealtClubs, 'every dealt club is won by someone');
        const fin = g.finishRound();
        assert.equal(fin.gameOver, round === R.ROUNDS - 1);
        R.SEATS.forEach((seat) => {
          assert.equal(fin.points[seat], R.scoreZone(g.state.clubsWon[seat], g.state.zones[seat]).points);
          assert.ok(fin.points[seat] <= 50 && fin.points[seat] % 10 === 0);
        });
      }
      assert.deepEqual(leaders, ['west', 'north', 'east', 'dealer']);
      assert.equal(g.state.phase, 'game-over');
      assert.equal(g.state.history.length, 4);
    }
  });
}

test('AI play toward the zone: simulation guard', () => {
  const hit = { 0: 0, 1: 0, 2: 0 };
  const use = { 0: 0, 1: 0, 2: 0 };
  let total = 0, lost = 0, bonus = 0, none = 0, noneLost = 0, finalSum = 0; // lost/bonus are summed in points
  const games = 300;
  for (let seed = 1; seed <= games; seed++) {
    const g = createGame({ rng: mulberry32(1000 + seed) });
    while (g.state.phase !== 'game-over') {
      g.startRound();
      while (g.state.phase === 'playing') {
        for (let i = 0; i < 4; i++) { const seat = g.state.turn; g.play(seat, g.aiPick(seat).id); }
        g.completeBook();
      }
      const fin = g.finishRound();
      R.SEATS.forEach((seat) => {
        total++;
        const z = fin.zones[seat];
        if (z === null) { none++; if (fin.points[seat] < 0) noneLost -= fin.points[seat]; return; }
        use[z]++;
        if (fin.kinds[seat] === 'bonus') { hit[z]++; bonus += fin.points[seat]; }
        if (fin.points[seat] < 0) lost -= fin.points[seat];
      });
    }
    R.SEATS.forEach((seat) => (finalSum += g.state.gamePoints[seat]));
  }
  assert.equal(none, total / 4, 'one player in four has no zone each round');
  R.ZONES.forEach((z) => assert.equal(use[z.id], total / 4));
  // hit rates: 0-2 is the common zone, 5-6 the rare one
  assert.ok(hit[0] / use[0] > 0.5 && hit[0] / use[0] < 0.85, '0-2 hit ' + (hit[0] / use[0]).toFixed(2));
  assert.ok(hit[1] / use[1] > 0.15 && hit[1] / use[1] < 0.5, '3-4 hit ' + (hit[1] / use[1]).toFixed(2));
  assert.ok(hit[2] / use[2] > 0.03 && hit[2] / use[2] < 0.3, '5-6 hit ' + (hit[2] / use[2]).toFixed(2));
  // having no zone is the one real handicap: it costs more than a zone round does on average
  const noneAvg = noneLost / none; // points lost per no-zone round
  const zoneAvg = (lost - bonus) / (total - none); // net points lost per zoned round (rewards counted back)
  assert.ok(noneAvg > 8 && noneAvg < 25, 'no-zone loss ' + noneAvg.toFixed(1));
  assert.ok(zoneAvg < noneAvg - 5, 'zone rounds score better than no-zone rounds (' + zoneAvg.toFixed(1) + ' vs ' + noneAvg.toFixed(1) + ')');
  const avgFinal = finalSum / (games * 4);
  assert.ok(avgFinal > 70 && avgFinal < 100, 'average final ' + avgFinal.toFixed(1));
});

test('player names: a real hurricane name per seat, different every game', () => {
  const N = require('../js/names.js');
  assert.ok(N.HURRICANE_NAMES.length > 200);
  assert.equal(new Set(N.HURRICANE_NAMES).size, N.HURRICANE_NAMES.length, 'no duplicates in the list');
  assert.ok(N.HURRICANE_NAMES.every((n) => /^[A-Z][a-z]+$/.test(n)), 'plain single-word names');
  for (const name of ['Hugo', 'Katrina', 'Camille', 'Andrew', 'Sandy', 'Arthur', 'Wendy']) assert.ok(N.HURRICANE_NAMES.includes(name), name);

  for (let seed = 1; seed <= 300; seed++) {
    let a = seed;
    const rng = () => { a = (a * 1664525 + 1013904223) % 4294967296; return a / 4294967296; };
    const picked = N.pickNames(R.SEATS, rng);
    const names = R.SEATS.map((s) => picked[s]);
    assert.equal(new Set(names).size, 4, 'four different names');
    assert.ok(names.every((n) => N.HURRICANE_NAMES.includes(n)));
    assert.ok(picked.dealer.length <= N.MAX_HUMAN_LENGTH, 'the human name has to fit "(You)" on the scorecard');
  }
  const first = N.pickNames(R.SEATS, () => 0.5);
  assert.deepEqual(N.pickNames(R.SEATS, () => 0.5), first, 'same random source gives the same names');
  const seen = new Set();
  for (let i = 0; i < 40; i++) seen.add(N.pickNames(R.SEATS).west);
  assert.ok(seen.size > 10, 'random picks vary');
});

test('player names show up in the scorecards, book dialogs and scoreboards, and can be reset', () => {
  R.setPlayerNames({ dealer: 'Hugo', west: 'Ida', north: 'Camille', east: 'Ike' });
  assert.equal(R.SEAT_NAME.dealer, 'Hugo (You)');
  assert.equal(R.SEAT_NAME.north, 'Camille');
  const titles = R.SEATS.map((w) => R.describeBook({ winner: w, reason: 'highest-lead-suit', clubs: 0 }).title);
  assert.deepEqual(titles, ['Hugo (You) won the book!', 'Ida won the book!', 'Camille won the book!', 'Ike won the book!']);
  R.resetPlayerNames();
  assert.equal(R.SEAT_NAME.dealer, 'Dealer (You)');
  assert.equal(R.SEAT_TITLE.east, 'Player East');
});

test('Hard Mode off = Medium (4 rounds), on = Hard (8 rounds, looks ahead)', () => {
  assert.deepEqual(R.LEVELS.map((l) => l.rounds), [4, 8]);
  assert.deepEqual(R.LEVELS.map((l) => l.label), ['Medium', 'Hard']);
  assert.equal(R.levelInfo(undefined).id, R.DEFAULT_LEVEL);
  assert.equal(R.levelFor(false).label, 'Medium');
  assert.equal(R.levelFor(true).label, 'Hard');
  assert.ok(R.LEVELS.every((l) => l.mistakes === 0), 'no level makes deliberate mistakes any more');
  assert.ok(!R.LEVELS[0].search && R.LEVELS[1].search > 0, 'only Hard looks ahead');
  [1, 2].forEach((lv) => {
    const g = createGame({ rng: mulberry32(40 + lv), level: lv });
    assert.equal(g.state.totalRounds, 4 * lv);
    let rounds = 0;
    while (g.state.phase !== 'game-over') {
      g.startRound();
      while (g.state.phase === 'playing') {
        while (g.state.phase === 'playing' && g.state.book.length < 4) g.play(g.state.turn, g.aiPick(g.state.turn).id);
        g.completeBook();
      }
      g.finishRound();
      rounds++;
    }
    assert.equal(rounds, 4 * lv);
    assert.equal(g.state.history.length, 4 * lv);
  });
});

test('zones keep rotating cleanly past round 4', () => {
  assert.deepEqual(R.zonesForRound(4), R.zonesForRound(0));
  assert.deepEqual(R.zonesForRound(9), R.zonesForRound(1));
  assert.equal(R.leaderForRound(5), R.leaderForRound(1));
});

test('100-point cap rule: 0 or less and 200 or more bounce back to 100', () => {
  assert.equal(R.CAP_LOW, 0);
  assert.equal(R.CAP_HIGH, 200);
  assert.deepEqual(R.applyCap(1), { total: 1, bounce: null });
  assert.deepEqual(R.applyCap(199), { total: 199, bounce: null });
  assert.deepEqual(R.applyCap(0), { total: 100, bounce: 'low' });
  assert.deepEqual(R.applyCap(-70), { total: 100, bounce: 'low' });
  assert.deepEqual(R.applyCap(200), { total: 100, bounce: 'high' });
  assert.deepEqual(R.applyCap(230), { total: 100, bounce: 'high' });
});

test('engine applies the cap after each round and reports the bounce', () => {
  const g = createGame({ rng: mulberry32(11) });
  g.startRound();
  while (g.state.phase === 'playing') {
    for (let i = 0; i < 4; i++) { const seat = g.state.turn; g.play(seat, g.aiPick(seat).id); }
    g.completeBook();
  }
  // force the totals so the next scoring crosses each limit
  g.state.gamePoints.dealer = 5;   // any loss takes it to 0 or below
  g.state.gamePoints.west = 195;   // any win takes it to 200 or above
  g.state.gamePoints.north = 100;
  g.state.gamePoints.east = 100;
  const fin = g.finishRound();
  R.SEATS.forEach((seat) => {
    const expected = R.applyCap([5, 195, 100, 100][R.SEATS.indexOf(seat)] + fin.points[seat]);
    assert.equal(fin.before[seat], [5, 195, 100, 100][R.SEATS.indexOf(seat)] + fin.points[seat]);
    assert.equal(fin.bounces[seat], expected.bounce);
    assert.equal(g.state.gamePoints[seat], expected.total);
    assert.ok(g.state.gamePoints[seat] > 0 && g.state.gamePoints[seat] < 200, 'totals stay strictly between 0 and 200');
  });
});

test('totals always stay between 1 and 199 over full games', () => {
  for (let n = 0; n < 40; n++) {
    const g = createGame({ rng: mulberry32(500 + n), rounds: 8 });
    while (g.state.phase !== 'game-over') {
      g.startRound();
      while (g.state.phase === 'playing') {
        for (let i = 0; i < 4; i++) { const seat = g.state.turn; g.play(seat, g.aiPick(seat).id); }
        g.completeBook();
      }
      g.finishRound();
      R.SEATS.forEach((seat) => assert.ok(g.state.gamePoints[seat] >= 1 && g.state.gamePoints[seat] <= 199));
    }
  }
});

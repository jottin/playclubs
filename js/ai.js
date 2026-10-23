/*
 * CLUBS - computer opponents.
 * Estimates, for every legal card, how many club points it is likely to cost,
 * then plays the cheapest one. It plays toward the safe zone it was issued (or just avoids clubs with none). Pure logic; works in the browser and in Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rules.js'));
  else root.ClubsAI = factory(root.ClubsRules);
})(typeof self !== 'undefined' ? self : this, function (R) {
  'use strict';

  // How bad is finishing the round with n clubs? (7 is great, >7 is a disaster.)
  function roundUtility(n) {
    if (n === 7) return -6;
    if (n > 7) return 14;
    return n;
  }

  // Expected change in utility from winning k more clubs (k may be fractional).
  // `util(n)` is the penalty for finishing the round with n clubs (lower is better).
  function marginalCost(util, have, k) {
    const lo = Math.floor(k);
    const frac = k - lo;
    const a = util(have + lo) - util(have);
    const b = util(have + lo + 1) - util(have);
    return a + frac * (b - a);
  }

  const DECK = R.createDeck(); // built once; the AI only reads it

  // What the AI can reason about: cards it has not seen yet.
  function unseenInfo(hand, played) {
    const known = new Set();
    hand.forEach((c) => known.add(c.id));
    played.forEach((c) => known.add(c.id));
    const info = { total: 0, bySuit: { clubs: 0, diamonds: 0, spades: 0, hearts: 0 }, nonClubRanks: [], clubRanks: [], suitRanks: { diamonds: [], spades: [], hearts: [] } };
    DECK.forEach((c) => {
      if (known.has(c.id)) return;
      info.total++;
      info.bySuit[c.suit]++;
      if (c.suit === 'clubs') info.clubRanks.push(c.rank);
      else { info.nonClubRanks.push(c.rank); info.suitRanks[c.suit].push(c.rank); }
    });
    return info;
  }

  // Chance an opponent holding `size` unseen cards has at least one card of `suit`.
  function chanceHasSuit(info, size, suit) {
    const count = info.bySuit[suit] || 0;
    let none = 1;
    for (let i = 0; i < size; i++) {
      const pool = info.total - i;
      if (pool <= 0) break;
      none *= Math.max(0, pool - count) / pool;
    }
    return 1 - none;
  }

  // Chance an opponent holding `size` unseen cards has at least one card of `suit` whose rank passes `test`.
  function chanceHasAnyOf(info, size, suit, test) {
    const ranks = (suit === 'clubs' ? info.clubRanks : info.suitRanks[suit]) || [];
    const good = ranks.filter(test).length;
    let none = 1;
    for (let i = 0; i < size; i++) {
      const pool = info.total - i;
      if (pool <= 0) break;
      none *= Math.max(0, pool - good) / pool;
    }
    return 1 - none;
  }

  function costOf(card, ctx, info, leadSuit) {
    const book = ctx.book;
    const leading = book.length === 0;
    const remaining = 3 - book.length; // players still to act after us
    const have = ctx.clubsWon;
    const util = ctx.util;
    const handSize = ctx.hand.length;
    const clubsSoFar = book.filter((p) => p.card.suit === 'clubs').length;
    const pHasClub = chanceHasSuit(info, handSize, 'clubs');
    const pHasLead = chanceHasSuit(info, handSize, leading ? card.suit : leadSuit);
    let cost = 0;

    const topClub = book.reduce((m, p) => (p.card.suit === 'clubs' ? Math.max(m, p.card.rank) : m), 0);
    const higherClubs = info.clubRanks.filter((r) => r > card.rank).length;
    const pClubBeat = info.clubRanks.length ? higherClubs / info.clubRanks.length : 0;

    if (leading && card.suit === 'clubs') {
      // A club-led book goes to the highest club; if nobody can match, the leader keeps it.
      const pWin = Math.pow(1 - pHasClub * pClubBeat, 3);
      cost = pWin * marginalCost(util, have, 1 + 3 * pHasClub);
    } else if (leading) {
      // Only the leading suit can win a non-club book: we win unless an opponent holds a higher card of it.
      const pBeatOne = chanceHasAnyOf(info, handSize, card.suit, (r) => r > card.rank);
      cost = Math.pow(1 - pBeatOne, 3) * marginalCost(util, have, 0.9);
    } else if (leadSuit === 'clubs') {
      // Club-led: only a higher club than everything so far can win; non-clubs never can.
      if (card.suit === 'clubs' && card.rank > topClub) {
        const pWin = Math.pow(1 - pHasClub * pClubBeat, remaining);
        cost = pWin * marginalCost(util, have, clubsSoFar + 1 + remaining * pHasClub);
      }
    } else if (card.suit === leadSuit) {
      // Following suit: we win only with the highest card of the leading suit played so far,
      // and only if nobody still to act holds a higher one.
      const topLead = book.reduce((m, p) => (p.card.suit === leadSuit ? Math.max(m, p.card.rank) : m), 0);
      if (card.rank > topLead) {
        const pBeatOne = chanceHasAnyOf(info, handSize, leadSuit, (r) => r > card.rank);
        cost = Math.pow(1 - pBeatOne, remaining) * marginalCost(util, have, clubsSoFar + remaining * 0.3);
      }
    }
    // (A club played to a non-club-led book can never win it, so it costs nothing.)

    // Tie-breakers when the risk is similar: dump clubs on others, shed high cards.
    if (card.suit === 'clubs') cost += ctx.wantClubs ? 0.3 : -0.5;
    else cost -= 0.1 * (card.rank / 14);
    return cost;
  }

  /*
   * ctx = {
   *   hand:     cards in this player's hand,
   *   book:     [{ seat, card }] already played to the current book (lead first),
   *   clubsWon: clubs this player has won so far this round,
   *   played:   every card played so far this round (including the current book),
   *   rng:      optional random source for tie-breaking
   *   utility:  optional n => cost of ending the round with n clubs, in clubs not points (the engine passes the player's safe zone here);
   *             defaults to the original "fewer clubs is better" scoring
   * }
   */
  function chooseCard(ctx) {
    const leadSuit = ctx.book.length ? ctx.book[0].card.suit : null;
    const legal = R.legalCards(ctx.hand, leadSuit);
    if (legal.length === 1) return legal[0];

    const random = ctx.rng || Math.random;
    // Easier levels sometimes play a random legal card instead of the best one.
    if (ctx.mistakes && random() < ctx.mistakes) return legal[Math.floor(random() * legal.length)];
    const info = unseenInfo(ctx.hand, ctx.played);
    const util = ctx.utility || roundUtility;
    const wantClubs = util(ctx.clubsWon + 1) < util(ctx.clubsWon); // one more club would help us
    const full = { hand: ctx.hand, book: ctx.book, clubsWon: ctx.clubsWon, util: util, wantClubs: wantClubs };

    let best = legal[0];
    let bestScore = Infinity;
    legal.forEach((card) => {
      const score = costOf(card, full, info, leadSuit) + random() * 0.05;
      if (score < bestScore) {
        bestScore = score;
        best = card;
      }
    });
    return best;
  }

  /*
   * Hard level: look ahead instead of just estimating. For each legal card, deal the unseen cards to the other
   * players at random (a few dozen times), play the rest of the round out with chooseCard for everyone, and keep the
   * card whose finished round scores best for this player on average. All cards are tried on the same deals.
   *
   * ctx = { mySeat, hand, book, played, clubsWon (seat -> n), zones (seat -> id|null), handSizes (seat -> n), rng, samples }
   */
  function chooseCardSearch(ctx) {
    const random = ctx.rng || Math.random;
    const me = ctx.mySeat;
    const leadSuit = ctx.book.length ? ctx.book[0].card.suit : null;
    const legal = R.legalCards(ctx.hand, leadSuit);
    if (legal.length === 1) return legal[0];

    const known = new Set();
    ctx.hand.forEach((c) => known.add(c.id));
    ctx.played.forEach((c) => known.add(c.id));
    const unseen = DECK.filter((c) => !known.has(c.id));
    const others = R.SEATS.filter((x) => x !== me);
    const utils = {};
    R.SEATS.forEach((x) => (utils[x] = R.zoneUtility(ctx.zones[x])));
    const samples = ctx.samples || 24;
    const totals = legal.map(() => 0);

    for (let n = 0; n < samples; n++) {
      // One possible world: a random deal of the unseen cards to the other players.
      const pool = R.shuffle(unseen, random);
      const hands = {};
      let at = 0;
      others.forEach((x) => {
        hands[x] = pool.slice(at, at + ctx.handSizes[x]);
        at += ctx.handSizes[x];
      });
      legal.forEach((card, i) => {
        const h = {};
        others.forEach((x) => (h[x] = hands[x].slice()));
        h[me] = ctx.hand.filter((c) => c.id !== card.id);
        const won = Object.assign({}, ctx.clubsWon);
        let book = ctx.book.concat([{ seat: me, card: card }]);
        const played = ctx.played.concat([card]);
        let turn = R.nextSeat(me);
        for (;;) {
          while (book.length < R.SEATS.length) {
            const pick = chooseCard({ hand: h[turn], book: book, clubsWon: won[turn], played: played, rng: random, utility: utils[turn] });
            h[turn].splice(h[turn].indexOf(pick), 1);
            book.push({ seat: turn, card: pick });
            played.push(pick);
            turn = R.nextSeat(turn);
          }
          const res = R.resolveBook(book);
          won[res.winner] += res.clubs;
          if (R.SEATS.every((x) => h[x].length === 0)) break;
          book = [];
          turn = res.winner;
        }
        totals[i] += R.scoreZone(won[me], ctx.zones[me]).points;
      });
    }
    let best = 0;
    totals.forEach((t, i) => { if (t > totals[best]) best = i; });
    return legal[best];
  }

  return { chooseCard, chooseCardSearch };
});

/*
 * CLUBS - pure game rules (no DOM, no timers).
 * Works in the browser (window.ClubsRules) and in Node (require).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ClubsRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SUITS = ['clubs', 'diamonds', 'spades', 'hearts'];
  const SUIT_CODE = { clubs: 'C', diamonds: 'D', spades: 'S', hearts: 'H' };
  const RANK_LABEL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }; // Aces high, 2s low

  // Clockwise order around the table, starting with the dealer (bottom of the screen).
  // Bottom -> left -> top -> right is clockwise on screen.
  const SEATS = ['dealer', 'west', 'north', 'east'];
  // Display names. These are plain objects that setPlayerNames() rewrites at the start of every game
  // (the game picks four random names); the defaults below are what you see without that.
  const SEAT_NAME = { dealer: 'Dealer (You)', west: 'West', north: 'North', east: 'East' };
  const SEAT_TITLE = { dealer: 'Dealer (You)', west: 'Player West', north: 'Player North', east: 'Player East' };
  const DEFAULT_NAMES = { name: Object.assign({}, SEAT_NAME), title: Object.assign({}, SEAT_TITLE) };

  // names = { dealer: 'Hugo', west: 'Ida', ... }. The human (dealer seat) is shown as "Hugo (You)".
  function setPlayerNames(names) {
    SEATS.forEach((seat) => {
      const label = seat === 'dealer' ? names[seat] + ' (You)' : names[seat];
      SEAT_NAME[seat] = label;
      SEAT_TITLE[seat] = label;
    });
  }
  function resetPlayerNames() {
    SEATS.forEach((seat) => {
      SEAT_NAME[seat] = DEFAULT_NAMES.name[seat];
      SEAT_TITLE[seat] = DEFAULT_NAMES.title[seat];
    });
  }

  const CARDS_PER_PLAYER = 7; // 4 players
  const BOOKS_PER_ROUND = CARDS_PER_PLAYER;
  const ROUNDS = 4; // every player leads one round (and holds each zone once); this is one "game"

  // Difficulty levels. The Settings dialog has one switch, Hard Mode: off = Medium, on = Hard.
  //   Medium  1 game (4 rounds). Plays toward its own safe zone using the odds (the computer player of milestones 1-9).
  //   Hard    2 games (8 rounds). search: 60. Looks ahead: for every legal card it deals the unseen cards 60 random ways,
  //           plays the round out, and picks the card that scores best on average. About 20 points a game better than Medium.
  // (`mistakes` is the chance a computer player plays a random legal card; the old Easy level used 0.25. No level uses it now,
  // but the engine and simulators still support it.)
  const LEVELS = [
    { id: 1, label: 'Medium', games: 1, rounds: ROUNDS, mistakes: 0, search: 0 },
    { id: 2, label: 'Hard', games: 2, rounds: ROUNDS * 2, mistakes: 0, search: 60 },
  ];
  const DEFAULT_LEVEL = 1;
  function levelInfo(id) {
    return LEVELS.find((l) => l.id === id) || LEVELS[DEFAULT_LEVEL - 1];
  }
  function levelFor(hardMode) {
    return hardMode ? LEVELS[1] : LEVELS[0];
  }

  function makeCard(suit, rank) {
    return Object.freeze({
      id: SUIT_CODE[suit] + rank,
      suit: suit,
      rank: rank,
      label: RANK_LABEL[rank] || String(rank),
    });
  }

  function createDeck() {
    const deck = [];
    for (const suit of SUITS) for (let rank = 2; rank <= 14; rank++) deck.push(makeCard(suit, rank));
    return deck;
  }

  function shuffle(list, rng) {
    const random = rng || Math.random;
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // 7 cards each; the other 24 are set aside face-down and unused this round.
  function deal(rng) {
    const deck = shuffle(createDeck(), rng);
    const hands = {};
    SEATS.forEach((seat, i) => {
      hands[seat] = deck.slice(i * CARDS_PER_PLAYER, (i + 1) * CARDS_PER_PLAYER);
    });
    return { hands: hands, setAside: deck.slice(SEATS.length * CARDS_PER_PLAYER) };
  }

  function nextSeat(seat) {
    return SEATS[(SEATS.indexOf(seat) + 1) % SEATS.length];
  }

  // The seat on a player's right (counter-clockwise neighbour).
  function rightOf(seat) {
    return SEATS[(SEATS.indexOf(seat) + SEATS.length - 1) % SEATS.length];
  }

  // Round 1: the player left of the dealer (West) leads. Each later round is led by the next
  // player clockwise: West, North, East, then the Dealer (the single human player) in round 4.
  function leaderForRound(roundIndex) {
    let leader = 'west';
    for (let i = 0; i < roundIndex; i++) leader = nextSeat(leader);
    return leader;
  }

  // Must follow the leading suit if possible; otherwise anything (clubs included).
  function legalCards(hand, leadSuit) {
    if (!leadSuit) return hand.slice();
    const follow = hand.filter((c) => c.suit === leadSuit);
    return follow.length ? follow : hand.slice();
  }

  /*
   * Decide who wins a completed book.
   *   plays = [{ seat, card }, ...] in play order (plays[0] is the lead)
   *
   * Rules as implemented:
   *   - if no other player matched the leading suit, the leader wins (whatever the ranks)
   *   - a book led by a club is won by the highest club
   *   - a book led by any other suit is won by the highest card of the LEADING suit; clubs and off-suit
   *     cards played to it can never win it
   * Every card in a suit has a different rank, so a book always has exactly one winner.
   */
  function resolveBook(plays) {
    if (!plays || !plays.length) throw new Error('resolveBook needs at least one play');
    const leadSuit = plays[0].card.suit;
    const clubs = plays.filter((p) => p.card.suit === 'clubs').length;

    // Nobody else could match the leading suit: the leader wins, whatever the ranks.
    if (!plays.slice(1).some((p) => p.card.suit === leadSuit)) {
      return { winner: plays[0].seat, reason: 'uncontested-lead', clubs: clubs, winningCard: plays[0].card };
    }

    const contenders = plays.filter((p) => p.card.suit === leadSuit);
    const top = Math.max.apply(null, contenders.map((p) => p.card.rank));
    const best = contenders.filter((p) => p.card.rank === top);
    const win = best[0];
    return { winner: win.seat, reason: leadSuit === 'clubs' ? 'highest-club' : 'highest-lead-suit', clubs: clubs, winningCard: win.card };
  }

  // Wording for the book confirmation dialog.
  function describeBook(result) {
    const text = {
      'highest-lead-suit': 'By playing the highest-ranked card of the leading suit.',
      'uncontested-lead': 'By leading a suit that no other player could match.',
      'highest-club': 'By playing the highest-ranked club card.',
    }[result.reason];
    return { title: SEAT_TITLE[result.winner] + ' won the book!', text: text };
  }

  /*
   * Safe zones and scoring (Milestone 6).
   * Nobody bids: at the start of each round every player is ISSUED a safe zone, and one player gets none.
   * Every club you win is worth 10 points, and everyone starts the game with 100.
   *   zone 0-2   finish with no clubs  +20   |   finish with 1 or 2 clubs  +10
   *   zone 3-4   finish with 3 or 4 clubs  +30
   *   zone 5-6   finish with 5 or 6 clubs  +50   (7 clubs misses the zone and costs 70)
   *   anything else: every club you won costs 10 points (winning no clubs is free)
   *   no zone this round: every club you won costs 10 points (the same, without the safety net)
   * The player with the MOST points after the last round wins.
   * Zones are numbered 0 (0-2), 1 (3-4) and 2 (5-6); a player with no zone has zone null.
   */
  const CLUB_POINTS = 10;
  const START_POINTS = 100;
  const ZONES = [
    { id: 0, min: 0, max: 2, label: '0-2', reward: 10, zeroReward: 20 },
    { id: 1, min: 3, max: 4, label: '3-4', reward: 30 },
    { id: 2, min: 5, max: 6, label: '5-6', reward: 50 },
  ];
  const NO_ZONE_LABEL = 'None';

  function zoneOf(id) {
    return ZONES.find((z) => z.id === id) || null;
  }
  function zoneLabel(id) {
    const z = zoneOf(id);
    return z ? z.label : NO_ZONE_LABEL;
  }
  // Short reward line for the UI, e.g. "+30" or "+10 (+20 for no clubs)".
  function zoneReward(id) {
    const z = zoneOf(id);
    if (!z) return '\u2212' + CLUB_POINTS + ' per club';
    return '+' + z.reward + (z.zeroReward ? ' (+' + z.zeroReward + ' for no clubs)' : '');
  }

  /*
   * Who holds which zone in a round. Round 0: the Dealer has no zone, then West gets 0-2, North 3-4, East 5-6.
   * Every round the pattern moves one seat clockwise, so over four rounds each player holds each zone once and
   * sits one round out with no zone. Returns { dealer: null|0|1|2, west: ..., north: ..., east: ... }.
   */
  function zonesForRound(roundIndex) {
    const out = {};
    SEATS.forEach((seat, i) => {
      const slot = (((i - roundIndex) % SEATS.length) + SEATS.length) % SEATS.length; // 0 = no zone
      out[seat] = slot === 0 ? null : slot - 1;
    });
    return out;
  }

  // kind: 'bonus' (inside your zone), 'free' (no clubs and not in your zone, so nothing lost), 'miss' (clubs lost)
  function scoreZone(won, zoneId) {
    const z = zoneOf(zoneId);
    if (z && won >= z.min && won <= z.max) return { points: won === 0 && z.zeroReward ? z.zeroReward : z.reward, kind: 'bonus' };
    if (won === 0) return { points: 0, kind: 'free' };
    return { points: -CLUB_POINTS * won, kind: 'miss' };
  }

  // The cost of ending a round with n clubs when you hold this zone, in CLUBS (points / 10), which is the scale the
  // AI's card choice was tuned in. The AI plays against this.
  function zoneUtility(zoneId) {
    return (n) => -scoreZone(n, zoneId).points / CLUB_POINTS;
  }

  function scoreRound(clubsWon, zones) {
    const points = {};
    const kinds = {};
    SEATS.forEach((seat) => {
      const r = scoreZone(clubsWon[seat] || 0, zones[seat] === undefined ? null : zones[seat]);
      points[seat] = r.points;
      kinds[seat] = r.kind;
    });
    return { points: points, kinds: kinds };
  }

  // Most points first; ties share a place (1, 1, 3, 4).
  function rankPlayers(totals) {
    const rows = SEATS.map((seat) => ({ seat: seat, points: totals[seat] === undefined ? START_POINTS : totals[seat] }));
    rows.sort((a, b) => b.points - a.points); // stable: ties keep table order
    rows.forEach((row) => {
      row.place = 1 + rows.filter((r) => r.points > row.points).length;
    });
    return rows;
  }

  return {
    SUITS, SEATS, SEAT_NAME, SEAT_TITLE, setPlayerNames, resetPlayerNames, CARDS_PER_PLAYER, BOOKS_PER_ROUND, ROUNDS,
    LEVELS, DEFAULT_LEVEL, levelInfo, levelFor,
    makeCard, createDeck, shuffle, deal, nextSeat, rightOf, leaderForRound,
    legalCards, resolveBook, describeBook, scoreZone, zoneUtility, scoreRound, rankPlayers,
    CLUB_POINTS, START_POINTS, ZONES, NO_ZONE_LABEL, zoneOf, zoneLabel, zoneReward, zonesForRound,
  };
});

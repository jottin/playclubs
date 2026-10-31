/*
 * CLUBS - UI layer: rendering, animations, dialogs, tooltips.
 * No game rules in here. game.js tells it what to show.
 */
(function (root) {
  'use strict';
  const R = root.ClubsRules;

  const $ = (sel, parent) => (parent || document).querySelector(sel);
  const SUIT_ORDER = R.SUITS; // clubs, diamonds, spades, hearts: black/red alternate after the clubs
  const BASE = 'translate(-50%, -50%)';
  const ORDINAL = ['', '1st', '2nd', '3rd', '4th'];

  const els = {};
  let handCards = new Map(); // card id -> card
  let onHandClick = function () {};
  let zCounter = 1;
  let tipTimer = null;

  const UI = { timeScale: 1 };

  /* ---------- timing helpers ---------- */

  function motionScale() {
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return UI.timeScale * (reduce ? 0.3 : 1);
  }
  const dur = (ms) => Math.max(1, ms * motionScale());
  // The game's waits stop while the Settings dialog is open (UI.sleep resolves only once it closes).
  let pauseGate = null;
  UI.sleep = (ms) =>
    new Promise((resolve) => setTimeout(resolve, Math.max(0, ms * UI.timeScale))).then(() => pauseGate);

  /* ---------- setup ---------- */

  UI.init = function (handlers) {
    onHandClick = handlers.onHandClick;
    els.board = $('#board');
    els.table = $('#table');
    els.boardCards = $('#board-cards');
    els.hand = $('#hand');
    els.status = $('#status');
    els.statusItems = {};
    ['round', 'book', 'lead', 'zone'].forEach((key) => (els.statusItems[key] = $('#status-' + key)));
    els.deal = $('#deal-btn');
    els.tooltip = $('#tooltip');
    els.bookLayer = $('#book-layer');
    els.bookTitle = $('#book-title');
    els.bookText = $('#book-text');
    els.bookBtn = $('#book-continue');
    els.modalLayer = $('#modal-layer');
    els.modal = $('#modal');
    els.cards = {};
    R.SEATS.forEach((seat) => (els.cards[seat] = $('.scorecard[data-seat="' + seat + '"]')));
    initSettings();
  };

  /* ---------- Settings and Rules dialogs ---------- */

  // Opens from a button; the game pauses (UI.sleep waits) while it is open. Returns { open, close }.
  function wireDialog(layerSel, openSel, closeSel, onOpen, onClose) {
    const layer = $(layerSel);
    const btn = $(openSel);
    const closeBtn = $(closeSel);
    let release = null;
    function open() {
      if (pauseGate) return; // one dialog at a time
      pauseGate = new Promise((resolve) => (release = resolve));
      if (onOpen) onOpen();
      showLayer(layer, true);
      closeBtn.focus({ preventScroll: true });
    }
    function close() {
      if (!layer.classList.contains('show')) return;
      showLayer(layer, false);
      if (release) release();
      release = null;
      pauseGate = null;
      btn.focus({ preventScroll: true });
      if (onClose) onClose();
    }
    btn.addEventListener('click', open);
    closeBtn.addEventListener('click', close);
    layer.addEventListener('click', (e) => { if (e.target === layer) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    return { open: open, close: close };
  }

  function initSettings() {
    const S = window.ClubsSettings;
    const confirmSw = $('#set-confirm');
    const soundSw = $('#set-sound');
    const hardSw = $('#set-hard');
    const note = $('#set-note');
    let hardAtOpen = false; // Hard Mode as it was when the dialog opened

    function renderSwitch(sw, on) {
      sw.setAttribute('aria-checked', String(on));
      $('.switch-state', sw).textContent = on ? 'On' : 'Off';
    }
    function render() {
      const v = S.get();
      renderSwitch(confirmSw, v.confirmBooks);
      renderSwitch(soundSw, v.sound);
      renderSwitch(hardSw, v.hardMode);
      // Turning Hard Mode on restarts the game when the dialog closes (below), so say so, in bold.
      const restart = v.hardMode && !hardAtOpen;
      note.classList.toggle('is-strong', restart);
      note.textContent = restart
        ? 'Enabling Hard Mode will restart the game. Press the close button to continue.'
        : UI.settingsNote ? UI.settingsNote(v) : '';
    }
    const dlg = wireDialog('#settings-layer', '#settings-btn', '#settings-close', () => {
      hardAtOpen = S.get().hardMode;
      render();
    }, () => {
      // Closed with Hard Mode switched on: start over as a fresh 8-round game. The setting is already saved, so a reload
      // is the cleanest restart (it drops every timer and animation of the game in progress and lands on the Deal button).
      if (S.get().hardMode && !hardAtOpen) window.location.reload();
    });
    UI.openSettings = dlg.open;
    UI.closeSettings = dlg.close;

    confirmSw.addEventListener('click', () => S.set({ confirmBooks: !S.get().confirmBooks }));
    soundSw.addEventListener('click', () => {
      S.set({ sound: !S.get().sound });
      if (S.get().sound && window.ClubsSound) window.ClubsSound.play('phip'); // a sample click when turned on
    });
    hardSw.addEventListener('click', () => S.set({ hardMode: !S.get().hardMode }));
    S.onChange(render);

    // Rules: the long text scrolls inside the dialog; the title and Close button stay put.
    const rules = wireDialog('#rules-layer', '#rules-btn', '#rules-close', () => {
      $('#rules-body').scrollTop = 0;
    });
    UI.openRules = rules.open;
    UI.closeRules = rules.close;
  }

  // The Deal button at the start of every game. Resolves when it is tapped (the tap also unlocks browser audio).
  UI.waitForDeal = function () {
    return new Promise((resolve) => {
      els.deal.hidden = false;
      const done = () => {
        els.deal.removeEventListener('click', done);
        els.deal.hidden = true;
        resolve();
      };
      els.deal.addEventListener('click', done);
    });
  };

  // Fill the status elements (each is its own div in index.html): { round, book, lead, zone }.
  // A field you leave out is blanked, and a blank element takes no space. A plain string goes in "lead".
  UI.setStatus = function (fields) {
    const f = typeof fields === 'string' ? { lead: fields } : fields || {};
    Object.keys(els.statusItems).forEach((key) => {
      els.statusItems[key].textContent = f[key] || '';
    });
  };

  /* ---------- scorecards ---------- */

  UI.setActive = function (seat) {
    R.SEATS.forEach((s) => els.cards[s].classList.toggle('active', s === seat));
  };

  // Write each seat's current display name (R.SEAT_NAME) onto its scorecard.
  UI.setNames = function () {
    R.SEATS.forEach((seat) => {
      $('.name', els.cards[seat]).textContent = R.SEAT_NAME[seat];
    });
  };

  UI.setScore = function (seat, field, value, animate) {
    const b = $('[data-field="' + field + '"]', els.cards[seat]);
    if (b.textContent === String(value)) return;
    b.textContent = value;
    if (animate) {
      b.classList.remove('bump');
      void b.offsetWidth;
      b.classList.add('bump');
    }
  };

  // Scorecard zone line: "Zone 3-4 · Won: 1". Green while you are inside your zone, red once you have won more
  // clubs than the zone allows, plain while you are still short of it or have no zone.
  function refreshZoneState(seat) {
    const card = els.cards[seat];
    const zone = card.dataset.zone;
    if (zone === undefined || zone === 'none') {
      delete card.dataset.bidState;
      return;
    }
    const z = R.zoneOf(Number(zone));
    const won = Number(card.dataset.won || 0);
    card.dataset.bidState = won > z.max ? 'over' : won >= z.min ? 'exact' : 'under';
  }

  // zone: 0, 1, 2 or null (no zone this round)
  UI.setZone = function (seat, zone, animate) {
    if (animate && zone !== null && window.ClubsSound) window.ClubsSound.play('phip'); // a zone is issued
    els.cards[seat].dataset.zone = zone === null ? 'none' : String(zone);
    UI.setScore(seat, 'zone', R.zoneLabel(zone), animate);
    refreshZoneState(seat);
  };

  UI.setWon = function (seat, won, animate) {
    els.cards[seat].dataset.won = String(won);
    UI.setScore(seat, 'won', won, animate);
    refreshZoneState(seat);
  };

  UI.clearZones = function () {
    R.SEATS.forEach((seat) => {
      const card = els.cards[seat];
      delete card.dataset.zone;
      delete card.dataset.bidState;
      card.dataset.won = '0';
      $('[data-field="zone"]', card).innerHTML = '&ndash;';
      $('[data-field="won"]', card).textContent = '0';
    });
  };

  function seatRect(seat) {
    return els.cards[seat].getBoundingClientRect();
  }

  /* ---------- cards ---------- */

  function cardEl(card, tag) {
    const el = document.createElement(tag || 'div');
    const red = card.suit === 'hearts' || card.suit === 'diamonds';
    el.className = 'card' + (red ? ' red' : '');
    el.dataset.id = card.id;
    el.setAttribute('aria-label', card.label + ' of ' + card.suit);
    el.innerHTML =
      '<span class="val">' + card.label + '</span>' +
      '<span class="val val-b" aria-hidden="true">' + card.label + '</span>' + // second index, bottom-left, so an overlapped card still shows its value
      '<svg class="suit" aria-hidden="true"><use href="#s-' + card.suit + '"/></svg>';
    return el;
  }

  function sortHand(cards) {
    return cards.slice().sort((a, b) => SUIT_ORDER.indexOf(a.suit) - SUIT_ORDER.indexOf(b.suit) || a.rank - b.rank);
  }

  UI.renderHand = function (cards) {
    els.hand.innerHTML = '';
    handCards = new Map();
    els.hand.style.setProperty('--n', Math.max(cards.length, 1));
    sortHand(cards).forEach((card) => {
      const el = cardEl(card, 'button');
      el.type = 'button';
      el.classList.add('hand-card', 'dim');
      el.setAttribute('aria-disabled', 'true');
      el.addEventListener('click', () => onHandClick(card, el));
      els.hand.appendChild(el);
      handCards.set(card.id, card);
    });
  };

  // legalIds: Set of playable card ids, or null when it is not the dealer's turn.
  UI.markHand = function (legalIds) {
    els.hand.querySelectorAll('.hand-card').forEach((el) => {
      const ok = !!legalIds && legalIds.has(el.dataset.id);
      el.classList.toggle('playable', ok);
      el.classList.toggle('dim', !ok);
      el.setAttribute('aria-disabled', ok ? 'false' : 'true');
    });
  };

  UI.handCardRect = function (id) {
    const el = els.hand.querySelector('[data-id="' + id + '"]');
    return el ? el.getBoundingClientRect() : null;
  };

  UI.removeHandCard = function (id) {
    const el = els.hand.querySelector('[data-id="' + id + '"]');
    if (el) el.remove();
    handCards.delete(id);
    els.hand.style.setProperty('--n', Math.max(handCards.size, 1));
  };

  /* ---------- board animations ---------- */

  // Ease a card from its origin (the dealer's hand card, or the AI's scorecard) to its slot.
  UI.placeCard = function (seat, card, fromRect) {
    const el = cardEl(card);
    el.classList.add('board-card');
    el.dataset.seat = seat;
    el.style.zIndex = String(++zCounter);
    els.boardCards.appendChild(el);

    if (window.ClubsSound) window.ClubsSound.play('slide'); // card slides onto the felt
    const to = el.getBoundingClientRect();
    const from = fromRect || seatRect(seat);
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    const scale = fromRect ? fromRect.width / to.width : 0.7;

    const anim = el.animate(
      [
        { transform: BASE + ' translate(' + dx + 'px,' + dy + 'px) scale(' + scale + ')', opacity: fromRect ? 1 : 0.15 },
        { transform: BASE, opacity: 1 },
      ],
      { duration: dur(480), easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
    );
    return anim.finished.catch(() => {});
  };

  // Mark the card that won the book with .is-winner so the stylesheet can highlight it. It stays until the pile gathers.
  UI.markWinner = function (cardId) {
    const el = els.boardCards.querySelector('[data-id="' + cardId + '"]');
    if (el) el.classList.add('is-winner');
  };

  // Gather the four cards into a loose, slightly offset pile, then slide the pile into the winner's scorecard.
  UI.collectBook = async function (winnerSeat) {
    const cards = Array.from(els.boardCards.children);
    if (!cards.length) return;
    cards.forEach((el) => el.classList.remove('is-winner')); // the highlight ends as the cards start to pile up
    const t = els.table.getBoundingClientRect();
    const cx = t.left + t.width / 2;
    const cy = t.top + t.height / 2;
    const jitter = [[-7, -5, -6], [6, -3, 4], [-4, 6, -2], [5, 5, 7]]; // x, y, rotation of each card in the pile

    const rects = cards.map((el) => el.getBoundingClientRect());
    const pile = rects.map((r, i) => {
      const j = jitter[i % jitter.length];
      return { x: cx - (r.left + r.width / 2) + j[0], y: cy - (r.top + r.height / 2) + j[1], rot: j[2] };
    });
    const tr = (x, y, rot, scale) => BASE + ' translate(' + x + 'px,' + y + 'px) rotate(' + rot + 'deg) scale(' + (scale || 1) + ')';

    // 1. slide inward into a stack
    await Promise.all(
      cards.map((el, i) =>
        el.animate(
          [{ transform: BASE }, { transform: tr(pile[i].x, pile[i].y, pile[i].rot) }],
          { duration: dur(380), easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' }
        ).finished.catch(() => {})
      )
    );

    // 2. immediately slide to the winner's scorecard
    if (window.ClubsSound) window.ClubsSound.play('shhhuuu');
    const target = seatRect(winnerSeat);
    await Promise.all(
      cards.map((el, i) => {
        const r = rects[i];
        const tx = target.left + target.width / 2 - (r.left + r.width / 2);
        const ty = target.top + target.height / 2 - (r.top + r.height / 2);
        return el.animate(
          [
            { transform: tr(pile[i].x, pile[i].y, pile[i].rot), opacity: 1, offset: 0 },
            { opacity: 1, offset: 0.7 },
            { transform: tr(tx, ty, pile[i].rot, 0.4), opacity: 0, offset: 1 },
          ],
          { duration: dur(480), easing: 'cubic-bezier(0.5, 0, 0.75, 0.4)', fill: 'forwards' }
        ).finished.catch(() => {});
      })
    );

    els.boardCards.innerHTML = '';
    const card = els.cards[winnerSeat];
    card.classList.remove('receive');
    void card.offsetWidth;
    card.classList.add('receive');
  };

  UI.clearBoard = function () {
    els.boardCards.innerHTML = '';
    zCounter = 1;
  };

  /* ---------- tooltip ---------- */

  UI.tooltip = function (text, anchor) {
    const tip = els.tooltip;
    tip.textContent = text;
    tip.classList.add('show');
    const r = anchor.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const cx = r.left + r.width / 2;
    const left = Math.min(Math.max(cx - w / 2, 8), window.innerWidth - w - 8);
    tip.style.left = left + 'px';
    tip.style.top = Math.max(8, r.top - h - 12) + 'px';
    tip.style.setProperty('--arrow-x', cx - left + 'px');
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => tip.classList.remove('show'), 3000); // always 3 seconds, then vanish
  };

  /* ---------- dialogs ---------- */

  function showLayer(layer, on) {
    layer.classList.toggle('show', on);
    layer.setAttribute('aria-hidden', on ? 'false' : 'true');
  }

  // Book confirmation: overlays the hand area; resolves when the player taps Continue.
  UI.showBookDialog = function (title, text) {
    return new Promise((resolve) => {
      els.bookTitle.textContent = title;
      els.bookText.textContent = text;
      showLayer(els.bookLayer, true);
      els.bookBtn.focus({ preventScroll: true });
      const done = () => {
        els.bookBtn.removeEventListener('click', done);
        showLayer(els.bookLayer, false);
        resolve();
      };
      els.bookBtn.addEventListener('click', done);
    });
  };

  function showModal(html, buttonId) {
    return new Promise((resolve) => {
      els.modal.innerHTML = html;
      showLayer(els.modalLayer, true);
      const btn = document.getElementById(buttonId);
      btn.focus({ preventScroll: true });
      btn.addEventListener('click', function done() {
        btn.removeEventListener('click', done);
        showLayer(els.modalLayer, false);
        resolve();
      });
    });
  }

  UI.showRoundSummary = function (d) {
    const rows = d.rows
      .map(
        (r) =>
          '<tr><td class="who">' + r.name + '</td><td>' + r.zone + '</td><td>' + r.won +
          '</td><td class="' + r.kind + '">' + r.pointsText + '</td><td class="total">' + r.total + (r.bounce ? ' \u21ba' : '') + '</td></tr>'
      )
      .join('');
    const html =
      '<h3 class="sheet-title">Round ' + d.round + ' complete</h3>' +
      '<p class="sheet-sub">Finish inside your safe zone: 0-2 pays +10 (+20 for no clubs), 3-4 pays +30, 5-6 pays +50. Otherwise each club won costs 10 points. Reach 0 or 200 and you bounce back to 100 (\u21ba).</p>' +
      '<table class="score-table"><thead><tr><th>Player</th><th>Zone</th><th>Won</th><th>Round</th><th>Game</th></tr></thead><tbody>' +
      rows + '</tbody></table>' +
      (d.note ? '<p class="sheet-note">' + d.note + '</p>' : '') +
      '<button id="modal-continue" class="btn" type="button">' + d.button + '</button>';
    return showModal(html, 'modal-continue');
  };

  UI.showFinal = function (d) {
    const rows = d.rows
      .map(
        (r) =>
          '<tr class="' + (r.place === 1 ? 'winner' : '') + '"><td><span class="place">' + ORDINAL[r.place] + '</span></td>' +
          '<td class="who">' + r.name + '</td>' +
          r.perRound.map((p) => '<td class="' + (p.charAt(0) === '+' ? 'bonus' : p.charAt(0) === '\u2212' ? 'miss' : '') + '">' + p + '</td>').join('') +
          '<td class="total">' + r.total + '</td></tr>'
      )
      .join('');
    const head = d.columns.map((c) => '<th>' + c + '</th>').join('');
    const html =
      '<h3 class="sheet-title">Final Scoreboard</h3>' +
      '<p class="sheet-sub">' + d.headline + '</p>' +
      '<table class="score-table"><thead><tr><th></th><th>Player</th>' + head + '<th>Total</th></tr></thead><tbody>' +
      rows + '</tbody></table>' +
      (d.note ? '<p class="sheet-note">' + d.note + '</p>' : '') +
      '<button id="modal-continue" class="btn" type="button">Play Again</button>';
    return showModal(html, 'modal-continue');
  };

  root.ClubsUI = UI;
})(window);

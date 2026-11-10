/*
 * CLUBS - UI layer: rendering, animations, dialogs, tooltips.
 * No game rules in here. game.js tells it what to show.
 */
(function (root) {
  'use strict';
  const R = root.ClubsRules;

  const $ = (sel, parent) => (parent || document).querySelector(sel);
  const $$ = (sel, parent) => Array.from((parent || document).querySelectorAll(sel));
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
  const SLIDE = 0.8; // card slide animations take this fraction of their original time (smaller = faster)
  const dur = (ms) => Math.max(1, ms * SLIDE * motionScale());
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
    const expertSw = $('#set-expert');
    const note = $('#set-note');
    let expertAtOpen = false; // Expert Mode as it was when the dialog opened

    function renderSwitch(sw, on) {
      sw.setAttribute('aria-checked', String(on));
      $('.switch-state', sw).textContent = on ? 'On' : 'Off';
    }
    function render() {
      const v = S.get();
      renderSwitch(confirmSw, v.confirmBooks);
      renderSwitch(soundSw, v.sound);
      renderSwitch(expertSw, v.expertMode);
      // Changing the mode restarts the game when the dialog closes (below), so say so, in bold. Switching it and back again does nothing.
      const restart = v.expertMode !== expertAtOpen;
      note.classList.toggle('is-strong', restart);
      note.textContent = !restart
        ? ''
        : v.expertMode
          ? 'Enabling Expert Mode will reset the game to ' + R.levelFor(true).games + ' playable games. Press the close button to continue.'
          : 'Disabling Expert Mode will reset the game to ' + R.levelFor(false).games + ' playable game. Press the close button to continue.';
    }
    const dlg = wireDialog('#settings-layer', '#settings-btn', '#settings-close', () => {
      expertAtOpen = S.get().expertMode;
      render();
    }, () => {
      // Closed with the mode changed (either way): start over as a fresh game in the new mode. The setting is already saved, so a
      // reload is the cleanest restart (it drops every timer and animation of the game in progress and lands on the Deal button).
      if (S.get().expertMode !== expertAtOpen) window.location.reload();
    });
    UI.openSettings = dlg.open;
    UI.closeSettings = dlg.close;

    confirmSw.addEventListener('click', () => S.set({ confirmBooks: !S.get().confirmBooks }));
    soundSw.addEventListener('click', () => {
      S.set({ sound: !S.get().sound });
      if (S.get().sound && window.ClubsSound) window.ClubsSound.play('phip'); // a sample click when turned on
    });
    expertSw.addEventListener('click', () => S.set({ expertMode: !S.get().expertMode }));
    S.onChange(render);

    // Info dialog (the ? button): About, Rules, FAQs and Privacy tabs. The text scrolls inside the dialog; the title,
    // tab row and Close button stay put. The tab that was open when it closed is the one shown next time (About on a first visit).
    const TABS = {
      about: 'About Playclubs.net',
      rules: 'Clubs Game Rules',
      faqs: 'Frequently Asked Questions',
      privacy: 'Privacy Policy',
    };
    const TAB_KEY = 'clubs.infoTab.v1';
    const tabBtns = $$('#rules-tabs [role="tab"]');
    const panels = $$('#rules-body .tab-panel');

    function savedTab() {
      try {
        const t = window.localStorage.getItem(TAB_KEY);
        return Object.prototype.hasOwnProperty.call(TABS, t) ? t : 'about';
      } catch (e) { return 'about'; }
    }
    function showTab(name, opts) {
      if (!Object.prototype.hasOwnProperty.call(TABS, name)) name = 'about';
      tabBtns.forEach((b) => {
        const on = b.dataset.tab === name;
        b.setAttribute('aria-selected', String(on));
        b.tabIndex = on ? 0 : -1;
        if (on && opts && opts.focus) b.focus({ preventScroll: true });
      });
      panels.forEach((p) => { p.hidden = p.id !== 'tab-' + name; });
      $('#rules-title').textContent = TABS[name];
      $('#rules-body').setAttribute('aria-label', TABS[name]);
      $('#rules-body').scrollTop = 0;
      try { window.localStorage.setItem(TAB_KEY, name); } catch (e) { /* ignore */ }
    }
    tabBtns.forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
    $('#rules-tabs').addEventListener('keydown', (e) => {
      const i = tabBtns.indexOf(document.activeElement);
      if (i < 0) return;
      let n = -1;
      if (e.key === 'ArrowRight') n = (i + 1) % tabBtns.length;
      else if (e.key === 'ArrowLeft') n = (i + tabBtns.length - 1) % tabBtns.length;
      else if (e.key === 'Home') n = 0;
      else if (e.key === 'End') n = tabBtns.length - 1;
      if (n < 0) return;
      e.preventDefault();
      showTab(tabBtns[n].dataset.tab, { focus: true });
    });
    // Links inside the text that jump to another tab (for example "rules").
    $('#rules-body').addEventListener('click', (e) => {
      const a = e.target.closest('a.tab-link');
      if (!a) return;
      e.preventDefault();
      showTab(a.dataset.tab);
    });

    // FAQs: the email address is only put together when asked for, so it is not sitting in the page for bots to harvest.
    $('#reveal-email').addEventListener('click', () => {
      const addr = ['support', 'playclubs.net'].join('@');
      const a = document.createElement('a');
      a.href = 'mailto:' + addr + '?subject=' + encodeURIComponent('Clubs');
      a.textContent = addr;
      const slot = $('#email-slot');
      slot.textContent = '';
      slot.appendChild(a);
      $('#reveal-email').hidden = true;
    });

    // Donate: stays switched off until a real https link is put in the button's href in index.html.
    const donate = $('#donate-link');
    if (!/^https:\/\//.test(donate.getAttribute('href') || '')) {
      donate.setAttribute('aria-disabled', 'true');
      donate.title = 'Donation link coming soon';
      donate.addEventListener('click', (e) => e.preventDefault());
    }

    const rules = wireDialog('#rules-layer', '#rules-btn', '#rules-close', () => {
      showTab(savedTab());
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
      $('.name', els.cards[seat]).textContent = R.SEAT_SHORT[seat];
    });
    // The hand label carries the human player's name, which always matches the south scorecard.
    const handTitle = $('.hand-title');
    if (handTitle) handTitle.textContent = 'Your Hand (' + R.SEAT_SHORT.dealer + ')';
  };

  // `before` (optional, Expert Mode's second game): game 1's final score, shown first in a <span> ahead of "+value".
  UI.setScore = function (seat, field, value, animate, before) {
    const b = $('[data-field="' + field + '"]', els.cards[seat]);
    const split = before !== null && before !== undefined;
    if (b.textContent === (split ? before + '|' : '') + value && b.querySelectorAll('span').length === (split ? 2 : 0)) return; // already showing this
    if (!split) b.textContent = value;
    else b.innerHTML = '<span>' + before + '</span><span>|</span>' + value;
    if (animate) {
      b.classList.remove('bump');
      void b.offsetWidth;
      b.classList.add('bump');
    }
  };
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

    // One animation per card (stack, then slide to the scorecard), so there is no hand-off between two animations.
    const target = seatRect(winnerSeat);
    const d1 = dur(380), d2 = dur(480);
    const split = d1 / (d1 + d2);
    if (window.ClubsSound) setTimeout(() => window.ClubsSound.play('shhhuuu'), d1);
    await Promise.all(
      cards.map((el, i) => {
        const r = rects[i];
        const tx = target.left + target.width / 2 - (r.left + r.width / 2);
        const ty = target.top + target.height / 2 - (r.top + r.height / 2);
        return el.animate(
          [
            { transform: BASE, opacity: 1, offset: 0, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
            { transform: tr(pile[i].x, pile[i].y, pile[i].rot), opacity: 1, offset: split, easing: 'cubic-bezier(0.5, 0, 0.75, 0.4)' },
            { opacity: 1, offset: split + (1 - split) * 0.7 },
            { transform: tr(tx, ty, pile[i].rot, 0.4), opacity: 0, offset: 1 },
          ],
          { duration: d1 + d2, fill: 'forwards' }
        ).finished.catch(() => {});
      })
    );

    els.boardCards.innerHTML = '';
    const card = els.cards[winnerSeat];
    card.classList.remove('receive');
    void card.offsetWidth;
    card.classList.add('receive');
  };

  // Face-down hand of a computer player, drawn behind its scorecard. n = cards left (0 empties it).
  UI.setOppHand = function (seat, n) {
    const box = document.querySelector('.opp-hand[data-seat="' + seat + '"]');
    if (!box) return;
    box.style.setProperty('--n', Math.max(n, 1));
    while (box.children.length > n) box.lastChild.remove();
    while (box.children.length < n) {
      const c = document.createElement('div');
      c.className = 'card-back';
      c.style.setProperty('--i', box.children.length);
      box.appendChild(c);
    }
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

  // Colour key for the round points: green inside the zone, red outside it, blue when the round caused a bounce back to 100.
  const LEGEND =
    '<p class="sheet-legend">' +
    '<span><b class="sw inside">\u25CF</b>: Inside Zone(+)</span>' +
    '<span><b class="sw outside">\u25CF</b>: Outside Zone(-)</span>' +
    '<span><b class="sw bounce">\u25CF</b>: Bounce(100\u21BA)</span>' +
    '</p>';

  UI.showRoundSummary = function (d) {
    const rows = d.rows
      .map(
        (r) =>
          '<tr><td class="who">' + r.name + '</td><td>' + r.zone + '</td><td>' + r.won +
          '</td><td class="' + (r.bounce ? 'bounce' : r.kind) + '">' + r.pointsText + '</td><td class="total">' + r.total + (r.bounce ? ' \u21ba' : '') + '</td></tr>'
      )
      .join('');
    const html =
      '<h3 class="sheet-title">Round ' + d.round + (d.game ? ' of game ' + d.game : '') + ' complete</h3>' +
      '<p class="sheet-sub">Inside zones: 0-2 (1-2 pays +10, 0 pays +20), 3-4 pays +30, 5-6 pays +50. Outside zones: each club costs -10 points. Bounce back to 100(\u21ba): 0 or 200 points scored in a round.</p>' +
      '<table class="score-table"><thead><tr><th>Player</th><th>Zone</th><th>Won</th><th>Round</th><th>' + (d.game ? 'Game ' + d.game : 'Game') + '</th></tr></thead><tbody>' +
      rows + '</tbody></table>' +
      (d.note ? '<p class="sheet-note">' + d.note + '</p>' : '') +
      LEGEND +
      '<button id="modal-continue" class="btn" type="button">' + d.button + '</button>';
    return showModal(html, 'modal-continue');
  };

  UI.showFinal = function (d) {
    const rows = d.rows
      .map(
        (r) =>
          '<tr class="' + (r.place === 1 ? 'winner' : '') + '"><td><span class="place">' + ORDINAL[r.place] + '</span></td>' +
          '<td class="who">' + r.name + '</td>' +
          r.perRound.map((p) => '<td class="' + p.kind + '">' + p.text + '</td>').join('') +
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
      (d.legend ? LEGEND : '') +
      '<button id="modal-continue" class="btn" type="button">Play Again</button>';
    return showModal(html, 'modal-continue');
  };

  root.ClubsUI = UI;
})(window);

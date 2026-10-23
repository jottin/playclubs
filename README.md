# Clubs (playclubs.net) - Milestone 9

Clubs is a trick-taking card game in which club cards decide the score. In a game where you face off against 3 opponents, all 4 players fight to win points. Points can be won or lost through each round as players hit or miss their safe zones. End the round inside your zone to win points—miss it, and every club costs you!

A 4-player card game: you (the Dealer) against three AI opponents (West, North, East).
Plain HTML, CSS and JavaScript. No build step, no dependencies.

## Run it

Open `index.html` in a browser, or serve the folder:

```
npm start          # npx serve .
npm test           # rules + AI + full-game simulations (Node 18+)
npm run build:single   # writes dist/clubs.html, one self-contained file
```

## Project layout

```
index.html        page structure + SVG suit icons
css/styles.css    all styling; layout sizes come from the variables at the top
js/rules.js       pure rules: deck, dealing, follow-suit, book winner, zone rotation, scoring, rankings
js/settings.js    player settings (book confirmation, difficulty) saved in localStorage
js/sound.js       sound effects made live with Web Audio (no audio files)
js/ai.js          opponent card choice (plays toward the safe zone it was issued)
js/engine.js      game state machine (rounds, safe zones, books, leaders). No DOM.
js/ui.js          rendering, card animations, dialogs, tooltips. No rules.
js/game.js        glue: runs the timing sequence between engine and UI
tests/            node:test suites, including 300 simulated full games
tools/            single-file build and the self-play simulator
```

The engine and rules never touch the DOM, so they can be reused as-is in a
React Native / Capacitor / Flutter-WebView wrapper or tested headlessly.

## Dev URL switches

`?seed=123` repeatable shuffles - `?fast=1` ~20x faster animations -
`?auto=1` AI plays the dealer and dialogs confirm themselves.

## Rules as implemented (confirmed or clarified by the game's author)

1. **Who wins a book.** If no other player matched the leading suit, the leader wins, whatever the ranks.
   If a club was led and matched, the highest club wins (non-clubs played to it cannot win).
   If any other suit was led and matched, the highest card of the *leading suit* wins; clubs and off-suit
   cards can never win it, however high they are. The dialog has just three explanations:
   "By playing the highest-ranked card of the leading suit.", "By leading the round without any player
   matching suit." and "By playing the highest-ranked club card."
2. **Who leads next.** The book winner.
3. **Round leaders.** West, North, East, then the Dealer (the human player) in round 4
   (`leaderForRound` in `rules.js`). The unmatched-lead rule applies to every suit, clubs included.
4. **Safe zones are issued, not chosen.** There is no bidding. At the start of every round each player is given
   a safe zone: **0-2**, **3-4** or **5-6** clubs, and one player has **no zone**. In round 1 the Dealer has no zone,
   West gets 0-2, North 3-4 and East 5-6. The pattern moves one seat clockwise each round (round 2: West has no
   zone, North 0-2, East 3-4, Dealer 5-6), so over four rounds every player holds each zone once and sits one
   round out with no zone. Zones show on every scorecard ("Zone 3-4 - Won: 1"). Only the four-player game is defined
   so far (`zonesForRound` in `rules.js`); 3 and 5 players are still to be decided.
5. **Scoring (Milestone 6).** Every club you win is worth 10 points. Everyone starts the game on 100 points; the highest
   total after the last round wins (4, 8 or 12 rounds, see Settings). Rewards grow as the zone gets harder to hit:
   - Zone **0-2**: finish with no clubs **+20**, or with 1 or 2 clubs **+10**.
   - Zone **3-4**: finish with 3 or 4 clubs **+30**.
   - Zone **5-6**: finish with 5 or 6 clubs **+50**. (M9: 7 clubs now misses the zone and costs 70.)
   - Otherwise every club you won costs **10** points. Winning no clubs never costs anything.
   - No zone: every club you win costs 10 points (the same, without the safety net). Winning no clubs scores 0.
   Examples: 0-2 / won 0 = +20, 0-2 / won 2 = +10, 0-2 / won 3 = -30, 3-4 / won 4 = +30, 3-4 / won 0 = 0,
   3-4 / won 2 = -20, 5-6 / won 6 = +50, 5-6 / won 7 = -70, 5-6 / won 4 = -40, no zone / won 2 = -20. Scores can end above 100.
   Scoring lives in `scoreZone` (`rules.js`). The AI weighs cards in *clubs* (points / 10): `zoneUtility`.
6. **Scorecards** show `Zone` and `Won` live (green check while you are inside your zone, red triangle once you have won more than it allows; plain with no zone) plus Game Points.
   Round Points appear only in the round summary dialog.
7. **Final ranking** uses shared places when game points are equal (1st, 1st, 3rd, 4th).

## Suit icons and player names

- The four suit icons live in one place: the `<symbol>` block at the top of `index.html` (`#s-clubs`, `#s-diamonds`,
  `#s-hearts`, `#s-spades`, 240x240 viewBox). Cards and the table watermark all `<use>` them, and colour comes from CSS.
  Red cards also colour their rank letters (`.card.red .val`).
- `js/names.js` holds the name list: every retired Atlantic hurricane name plus the six current rotating lists
  (224 names). `pickNames` gives each game four different names; the human (dealer seat) gets a name of 6 letters
  or fewer so "Name (You)" fits the scorecard. `R.setPlayerNames` pushes them into `SEAT_NAME` / `SEAT_TITLE`, which
  every dialog and scoreboard reads. With `?seed=N` the names are reproducible too.

## Zone badge (7)

A small target icon (`#s-zone` in the sprite, `.zone-badge` in the CSS) sits on the top-right corner of every scorecard
that holds a safe zone this round, so there are always three on the board (the player with no zone has none). It
pops on as each zone is issued and is driven by `data-zone` on the scorecard. Whether a player is currently inside
their zone is still shown by the green zone text and the check mark.

## Status area (7)

`#status` is a full-board overlay holding one div per item: `#status-brand` (playclubs v1), `#status-round`,
`#status-book`, `#status-lead` and `#status-zone`. By default the brand sits top-left and the other four stack
bottom-left. To move any item to a corner, add one class to its div in `index.html`: `at-tl`, `at-tr`, `at-bl` or
`at-br` (see "Status area" in `css/styles.css`; `--status-edge` sets the margin). An item with no text hides itself.
`UI.setStatus({round, book, lead, zone})` fills them; a plain string goes to "lead".

## Settings (9)

The "Settings" button (top-right of the board, `#settings-btn`) opens a dialog (`#settings-layer`); the game pauses while it is open.
Close with the button, Esc or a tap outside. Values are saved in localStorage (`js/settings.js`) when the browser allows it.

- **Book Confirmation** (on/off switch): off skips the dialog after each book; the cards just pause, then slide to the winner.
- **Difficulty Level** (slider, snaps to 1-3) sets how well the computer players play, and the number of rounds (`LEVELS` in `rules.js`):
  **Easy** plays a random legal card 25% of the time; **Medium** plays toward its own safe zone using the odds (the opponent of
  milestones 1-9); **Hard** looks ahead (`chooseCardSearch` in `ai.js`): for each legal card it deals the unseen cards 60 random ways,
  plays the round out and keeps the card with the best average score. Against three Medium players over a 4-round game the
  dealer seat averaged 69 points on Easy, 77 on Medium and 90 on Hard (500 games each), winning 22%, 25% and 32% of games.
- **Number of Rounds** follows the level: Easy 4 (1 game), Medium 8 (2 games), Hard 12 (3 games). Zones and leaders keep rotating
  every round. A change made mid-game affects the computer players at once, but the round count applies from the next game.
  Games longer than 4 rounds show one column per 4-round game (G1, G2, G3) on the final scoreboard.

## Rules dialog (9)

A round "?" button (`#rules-btn`, bottom-right of the board, same look as Settings) opens the rules (`#rules-layer`). The game pauses
while it is open. The title and the Close button stay in view and only the text between them (`#rules-body`) scrolls. The rules are
plain HTML inside `index.html`, written for the four-player game; edit them there. Close with the button, Esc or a tap outside.

## Deal button (9)

Each game waits at a **Deal** button (`#deal-btn`, centred in the hand area, which is empty until the cards are dealt) before the first
round is dealt, so a tap always comes before the first sound and browsers allow audio from the start. It also gives you a moment to
change Settings before a game begins. `?auto=1` presses it for you.

## Sound effects (9)

`js/sound.js` builds the three effects from filtered noise with the Web Audio API, so there are no audio files and it works from file://:

| Effect | When it plays |
|---|---|
| `phip` (card flick, ~50 ms) | a safe zone is issued to a scorecard (not for the player with no zone) |
| `slide` (the `shhhuuu` swish at half length, ~300 ms, pitch varies a little each time) | each card slides onto the felt |
| `shhhuuu` (rising then falling swish, ~500 ms) | the pile of four cards slides to the winner |

Settings has a **Sound Effects** on/off switch (saved with the other settings; turning it on plays a sample `phip`). Browsers keep
audio locked until the first tap or click, so effects before that are skipped. `?fast=1` is silent. To change how an effect sounds,
edit its recipe or `Sound.LEVEL` / `Sound.TRIM` in `sound.js`. `sounds-preview/*.wav` are renders of the three effects you can play in any player.

## Simulator and AI

`node tools/simulate.js` plays thousands of full games and reports, for each slot, the average points per round and
how often the zone is hit, plus the spread of final scores, ties and seat fairness. The AI plays each card toward
its zone (or just avoids clubs with none) and ignores everyone else's. Measured with 8000 games, average points
per round: 0-2 -0.5 (hit 71%), 3-4 -2.0 (hit 33%), 5+ -1.8 (hit 13%), no zone -13.7 (these were measured before M7's x10 scoring and the 5-6 change). With the 5-6 zone (3000 games, points per
round): 0-2 -1.8 (hit 69%), 3-4 -2.3 (hit 30%), 5-6 -7.3 (hit 9%, was -3.1 and 12% as 5+), no zone -14.8. 5-6 is now clearly the hardest zone; if it
feels too harsh, raise its `reward` in `ZONES` (`rules.js`). Average final 82 (sd 51), a
tie for first about 11%, about 36% of players finish above 100, and each seat wins about a quarter of the games.

## Next steps toward iPhone / Android

Wrap with Capacitor (`npm i @capacitor/core @capacitor/cli`, `npx cap init`, point `webDir` at this
folder or a copy of it). The viewport meta, safe-area insets and touch handling are already in place.

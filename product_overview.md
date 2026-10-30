# RockStyle Chess — Product Overview

*A client-facing summary of what has been built, what it does, and how it looks and feels.*

---

## 1. Product Overview

**RockStyle Chess** is a mobile chess application for phones. It lets a player
play real games of chess — against the phone, against another person on the
same device, or against other people online — inside a bold, stage‑and‑arena
visual theme built around a "rockstar concert" idea.

It is a full chess product, not a chess demo. The rules of chess are handled
correctly and completely, online matches are played in real time against real
opponents, results are saved to the player's account, and there is a rating
system, a match history, a puzzle trainer, a friends system, private messaging,
and a set of daily reward loops layered on top.

**What type of chess experience it provides**

* Quick, casual games against the computer at a range of strengths.
* Serious online games against other people, with a running skill rating.
* Solo tactics practice through a large puzzle library.
* A light "game with rewards" layer — daily bonuses, a prize wheel, quests,
  achievements, and unlockable board and piece designs.

**Who it is for**

* Casual players who want a good‑looking, easy chess app to play on their phone.
* More competitive players who want rated online matches and post‑game analysis.
* Players who enjoy games with progression, collectibles, and daily check‑ins.

**The main things a user can do**

* Play chess against six named computer opponents of increasing strength.
* Play chess with a friend passing one phone back and forth.
* Play rated chess online against a matched opponent, optionally for chips at
  the higher venues, or play friendly (unrated) games with a friend by invite
  code or direct challenge.
* Work through **The Tour**, a six‑chapter campaign of goals and boss bots, and
  take on **Festival Run**, a paid ladder of computer opponents with a growing
  purse.
* Solve chess puzzles and track progress through difficulty tiers.
* Review finished games move by move and buy a detailed computer analysis.
* Build a profile with an avatar, a display name, a rating, and a record.
* Add friends, see who is online, challenge them, and message them.
* Climb a global leaderboard.
* Earn Fame to level up and unlock titles; collect daily rewards, spin a prize
  wheel, complete daily and weekly quests, and unlock cosmetic boards, piece
  sets and avatars.

---

## 2. Product Vision & Experience

The application is built around a clear identity: **chess presented as a live
show**. The interface language throughout is concert and backstage themed — the
player's profile is an "Iron ID", the customization screen is "The Forge",
notifications are "Backstage Alerts", support is "Roadie Support", and playing
venues are named like tour stops ("The Garage", "The Club", "The Arena",
"Mainstage", "World Tour").

Based on how the app is actually built, the experience aims for:

* **A single, confident visual mood.** There is one fixed dark theme — deep,
  warm near‑black backgrounds, brushed‑metal surfaces, and glowing neon accents
  in orange, gold, and cyan. There is no light mode and no theme switching; the
  look is deliberate and consistent on every screen.
* **Modern, polished presentation.** Panels and buttons use soft rounded
  corners, layered gradients, gentle gloss highlights, and colored glow effects
  rather than flat blocks of color. Numbers count up when rewards are granted,
  the board animates every move, and screens have subtle ambient lighting behind
  the content.
* **Focus during play.** The match screen strips back to essentials — two player
  bars, the board, and a small action row. A started game cannot be casually
  swiped away; leaving requires resigning or finishing.
* **Speed and responsiveness.** Computer opponents are tuned so the app stays
  responsive even while the harder engines are "thinking". The board uses a
  animation system designed so pieces never flicker or jump.
* **Competition at the player's chosen stakes.** Online games are rated. The
  entry venue (The Garage) is free and a loss there costs nothing; from The Club
  up, both players put up a chip buy‑in and the winner takes the pot, so the
  player decides how much is at risk. The reward loops (daily bonus, spin,
  quests) are built around light, regular check‑ins rather than pressure.
* **Social presence.** Friends show real‑time status (online, in a game,
  offline), can be challenged directly, and can be messaged outside of games.

What the user is meant to feel: that they have opened something that looks like
a premium, characterful game — not a plain utility — while still getting a
correct and complete game of chess underneath.

---

## 3. Key Features

### Gameplay

**Play against the computer**

* Six computer opponents presented as named characters, across five strength
  levels. Three use a custom‑built chess "thinking" engine (a quick beginner
  level and two intermediate characters); three use a well‑known professional
  chess engine set to roughly 1600, 2000, and 2800 strength (about strong
  club level up to master level).
* Signed‑in players are rewarded for bot wins (chips and Fame by difficulty);
  the server checks the finished game before paying.
* Before starting, the player can choose which color to play, the time limit,
  and the venue backdrop.
* Useful because it gives a solo player a full range of challenge, from "just
  learning" to "very hard", with no waiting for an opponent and no internet
  required.

**Local two‑player (pass‑and‑play)**

* Two people share one phone and take turns. No account or internet needed.

**Online rated matches**

* The player is paired with the next person waiting at the same venue and time
  control, then plays a live game with moves appearing on both screens in real
  time. If nobody is waiting, the player can widen the search to other time
  controls.
* After the game, either player can offer a **rematch** (colors swap).
* Every move is checked by the server, so a player cannot cheat by sending an
  illegal move.

**Puzzles**

* A large library of real chess tactics puzzles (around 250), organized into
  five difficulty tiers and filterable by tactic type (forks, pins, mates, and
  so on).
* The player is shown a position and must find the correct move (or sequence of
  moves). Wrong tries are allowed and don't spoil the position — the player can
  simply try again.
* A **Hint** highlights which piece to move; **Give Up** plays out the full
  solution for the player to watch.
* Progress ("solved X of the total") is tracked, and a "Continue Training"
  shortcut jumps to the next unsolved puzzle in the current tier.

**Game review and analysis**

* Any finished game can be replayed move by move with transport controls
  (previous / next / play).
* The player can pay a small in‑game fee (in either currency) to run a full
  computer analysis, which labels each move as best, good, an inaccuracy, a
  mistake, or a blunder, shows an evaluation bar, and gives an overall accuracy
  read.

### Multiplayer

**Automatic matchmaking**

* The player picks a time control and joins a queue; the app pairs them with the
  next player waiting on the same clock at the same venue and drops both players
  straight into the game.

**Private rooms**

* A player can create a room and share a six‑character code; a friend enters the
  code to join. The code can be copied to the clipboard in one tap.

**Direct friend challenges**

* From the friends list, a player can challenge a friend who is online to a game
  at a chosen time control. The friend gets a prompt to accept or decline.

**In‑game chat**

* During an online match, the two players can send short chat messages to each
  other. (Chat is only available in online games.)

**Spectating**

* A "Front Row" screen lists matches that are live right now and lets the
  player watch one unfold in real time, including the current position and both
  clocks, with reaction emojis and a comment ticker.

**Reconnection**

* If a player's connection drops mid‑game, the match is held open for a grace
  period. If they get back within that window, they rejoin the same game with
  the correct position and clocks. If they don't return in time, the game is
  awarded to the opponent.

### User Account

**Accounts and guest play**

* A player can create an account with an email and password, or continue as a
  guest.
* Guests can play the computer, local games, and even online games, but their
  results, rating, friends, and rewards are not saved.
* An account unlocks the profile, rating, match history, friends, messaging, and
  all reward and progression features.

**Profile ("Iron ID")**

* Shows the player's avatar, display name, rating, win/loss/draw record, level
  and experience bar, currency balances, a personal friend code, a trophy
  display, and a tappable match history.

**Onboarding**

* New accounts pick a stage name and an avatar persona, then land on a welcome
  screen before entering the app.

### Social Features

**Friends**

* Add friends by entering their friend code. See each friend's live status
  (online, in a game, or offline). Per friend, the player can challenge them to
  a game, open a message thread, or remove them. Incoming and outgoing friend
  requests are shown and can be accepted or declined.

**Direct messages**

* Real one‑to‑one text conversations with friends, outside of any game.
  Conversation history is saved, unread counts are shown, and new messages
  arrive live.

**Notifications ("Backstage Alerts")**

* A single feed of real events — friend requests, friend challenges, and match
  results — plus reminders when a daily bonus, quest, or achievement reward is
  ready to claim. Items can be marked read individually or all at once.

### Progress & Competition

**Skill rating**

* Each account has a chess rating that goes up after wins and down after losses,
  by a standard, widely used method. Rating changes apply to online games
  between two signed‑in players.

**Leaderboard ("World Rankings")**

* A global ranking of players by rating, with a podium for the top three and the
  player's own position pinned for easy reference. A "Friends" view ranks the
  player's friends the same way. (Venue and Country rankings are shown as
  "Coming Soon".)

**Match history**

* Every online match between two accounts is saved with the result, the
  opponent, the rating change, and the full game for replay.

**Fame, levels and titles**

* Wins earn **Fame** (the game's experience points), with bonuses for the first
  win of the day and for win streaks. Fame raises the player's level; each level
  pays a small reward once, and milestone levels unlock titles shown next to the
  player's name. After every match a "Show Report" shows the Fame earned, the
  level bar filling, and the rating change.

**Daily bonus**

* A seven‑day login streak with escalating rewards and a larger day‑seven
  payout. (Requires an account.)

**Prize wheel ("Spin")**

* A once‑a‑day spinning wheel that awards currency or experience. The result is
  decided fairly on the server, then the wheel animates to land on it.
  (Requires an account.)

**Quests**

* Daily objectives tied to real gameplay (win games, capture pieces, solve
  puzzles, deliver checkmates). Completed quests can be claimed for rewards.
  Weekly quests ("Tour Dates") unlock at level 5.

**Achievements**

* A grid of long‑term badges for milestones (win totals, streaks, rating
  targets, puzzle counts, and more), each with a reward to claim when earned.

### Settings

* Toggle background music and sound effects on or off.
* View the account, open notifications, open help, and see a language row (the
  language selector itself is not yet active).
* Log out, or permanently delete the account.

### Other Features

**Customization ("The Forge")**

* Three cosmetic catalogs: **board themes** (5), **piece sets** (4), and
  **avatars** (77, in three classes: 12 free "Garage Band" avatars, "Main
  Stage" avatars for gems or chips, and "Hall of Fame" avatars for gems plus a
  minimum rating). Locked items are bought with in‑game gems or chips; owned
  items can be equipped. The equipped board and pieces are what the player sees
  in every game.

**Collections**

* A view of everything the player currently owns across boards, pieces, and
  avatars, with tap‑to‑equip.

**Currency**

* Two currencies: **chips** (earned from playing) and **gems** (premium; 1 gem
  is worth 40 chips). Both can be bought with real money through Google Play.
  They pay for cosmetics, game analysis, venue buy‑ins, Festival entries and
  Backstage Gear.

**Venues**

* Six venues, from "The Garage" to "World Tour". Each changes the atmosphere
  of the match screen (background image, accent color, glow intensity) but not
  the board or pieces. The Garage is free; from The Club up, online games are
  played for a real chip buy‑in (the winner takes the pot, minus a 10% house
  share; draws and very early exits are refunded), and the top venues also
  require a minimum rating. An optional "Safety Net" refunds part of the buy‑in
  on a loss.

### Campaign, Festival and Shop Extras

**The Tour**

* A six‑chapter campaign, one chapter per venue. Each chapter has five "gigs"
  (goals any game can advance, like winning as Black) and a boss bot; beating
  the boss unlocks the next chapter, pays a reward and grants a title. The final
  chapter, "The Encore", asks the player to beat all five bosses in a row.
* A player stuck on a boss can buy a one‑game **Roadie Kit** (one take‑back and
  one hint) after two real losses, and gets one free every few losses. It helps
  but never wins the game, and a kit game doesn't advance gigs.

**Festival Run**

* Pay an entry, then beat a ladder of computer opponents one set at a time.
  After each win the player can bank the purse or push on to a stronger opponent
  for a bigger one; a loss forfeits it. The opponent is played by the server so
  results can't be faked. Daily limits apply.

**Backstage Gear and Review Packs**

* Consumables bought with chips that never affect chess strength or rating:
  **Amp Boost** (extra Fame for the next three wins) and **Lucky Pick** (forgives
  one loss on a win streak). A **Review Pack** sells 10 game analyses at a
  discount.

**Ads**

* Optional rewarded ads give free chips, an extra spin, a doubled daily bonus,
  or a top‑up when the player can't afford the cheapest buy‑in. Occasional
  full‑screen ads appear only between activities (never during a game). A
  one‑time **Remove Ads** purchase turns those off.

---

## 4. Application Layout & Navigation

### Overall structure

The app is organized around a **bottom navigation bar** with five destinations,
present on the main screens:

* **Home** — the lobby and starting point.
* **Ranks** — the global leaderboard.
* **Play** — a mode picker (center button, visually raised above the bar).
* **Shop** — chips and gems packs, Remove Ads, Backstage Gear, plus a way into
  cosmetics.
* **Profile** — the player's full "Iron ID".

Everything else (settings, friends, messages, puzzles, a live match, results,
and so on) opens on top of these as a pushed screen with its own back button.

### How the user moves around

Navigation follows a **"back means up toward Home"** model rather than a strict
"undo my last step" model. Every back button and the phone's hardware back
button move the player one level up the hierarchy, ending at Home. Switching
between the five bottom‑bar sections doesn't stack history.

Two screens intentionally break the normal back behavior:

* **A live match** — pressing back opens a "Resign?" confirmation instead of
  leaving. The only ways out are finishing the game, resigning, or agreeing to a
  draw.
* **The result screen** — pressing back goes straight Home.

The left‑edge swipe‑back gesture is disabled everywhere, so a game can't be
swiped away by accident.

### Major screens at a glance

| Screen | Purpose |
|---|---|
| **Home** | Lobby: venue picker, a "Play Now" hero card, a grid of shortcuts to game modes, and a daily‑rewards row. The main screen showing live account data. |
| **Play** | A cleaner mode picker: Quick Match, Iron Duel, Play a Friend, The Tour, Festival Run, Vs Bots, Puzzles, Analysis Board. |
| **The Tour / Festival Run** | The campaign map with its gigs and bosses, and the paid bot ladder. |
| **Match** | The live chess game screen. |
| **Puzzle** | The single‑puzzle solving screen. |
| **Matchmaking / Game Room** | Waiting screens for finding an online opponent or a private‑room partner. |
| **Bots** | Gallery of the six computer opponents plus match options. |
| **Result** | Win / loss / draw summary after a game. |
| **Replay** | Move‑by‑move review and paid analysis of a finished game. |
| **Profile ("Iron ID")** | Full player profile, stats, match history, and links into social screens. |
| **World Rankings** | Global and Friends leaderboards. |
| **Friends / Messages / Spectate** | The social area. |
| **Puzzles** | The puzzle library and progress tracker. |
| **Shop / Forge / Collections** | Store, cosmetic customization, and owned‑items inventory. |
| **Daily Bonus / Spin / Quests / Achievements** | The reward loops. |
| **Settings ("Control Core") and its sub‑screens** | Audio, account, notifications, security, support. |

---

## 5. Screen‑by‑Screen Breakdown

### Sign In

**Purpose:** The entry point for anyone who isn't already signed in.

**What the user sees:** An arena background, a sign‑in form (email and
password), a link to create an account, and a "Continue as Guest" button.

**What the user can do:** Sign in, go to the sign‑up screen, or enter the app as
a guest.

**User experience:** A returning player who signs in goes straight to Home. A
guest is dropped straight into Home with a temporary identity. If a saved login
has expired, the app quietly returns the player here on next launch.

### Sign Up

**Purpose:** Create a new account.

**What the user sees:** The same visual style as Sign In, plus a "Welcome Bonus"
banner, an email/password/confirm form, and a (non‑functional) row of
social‑login buttons.

**What the user can do:** Register with an email and password.

**User experience:** After registering, the player continues into onboarding
(avatar and stage name) rather than straight to the app.

### Pick Your Rockstar (onboarding)

**Purpose:** Choose an avatar persona and a stage name.

**What the user sees:** A grid of avatar characters (each with a name and emoji)
and a text field for a stage name.

**What the user can do:** Select an avatar, type a name, and continue.

**User experience:** If saving the choice fails for any reason, onboarding still
continues — it never traps the player here.

### Welcome Reward (onboarding)

**Purpose:** A short celebratory hand‑off into the app.

**What the user sees:** A large chip icon and a reward number that counts up.

**What the user can do:** Continue to Home.

**User experience:** A brief "you're set up" moment. The starting balance is
credited when the account is created.

### Home (Lobby)

**Purpose:** The player's home base and main launch point.

**What the user sees:** A top bar with the player's identity and currency, a
horizontal venue selector, a large hero card for the selected venue (with its
buy‑in and prize shown and a "Play Now" button), a two‑by‑two grid of shortcuts
(Iron Duel, The Tour, Bots, Puzzles), and a "Daily Rewards" row (Daily Bonus,
Spin to Win). Soft ambient glows sit behind everything.

**What the user can do:** Pick a venue, choose a time control, start a match,
jump to any game mode, or open a daily reward.

**User experience:** This is the one lobby‑area screen that shows real, live
account information (currency balance in particular).

### Play (Mode Picker)

**Purpose:** A structured list of everything the player can start.

**What the user sees:** A "Quick Match" card with time‑format chips (Bullet,
Blitz, Rapid, Classical) and a "Find Match" button, then two grouped lists:
"Competitive" (Iron Duel, Play a Friend, The Tour, Festival Run) and "Casual &
Training" (Vs Bots, Puzzles, Analysis Board).

**What the user can do:** Start matchmaking at a chosen speed, or open any mode.

**User experience:** Note that the four Quick Match speed labels (1+0, 3+2,
10+0, 30+0) are display names; behind the scenes they map to the real 3‑ and
10‑minute queues, with no increment.

### Setup (Venue & Time)

**Purpose:** Choose a venue and time control before an Iron Duel.

**What the user sees:** A horizontally scrolling ladder of venues from "The
Garage" up to "World Tour", where the selected tile grows, plus a time‑control
picker.

**What the user can do:** Select an affordable venue and a duration, then
proceed to matchmaking.

**User experience:** Venues the player can't enter (not enough chips, rating
too low, or signed out) are dimmed and explain why. Each time control shows how
many players are searching. At a paid venue the player confirms the buy‑in and
can add the Safety Net.

### Matchmaking

**Purpose:** Wait while the app finds an online opponent.

**What the user sees:** A "Searching for opponent…" message, an elapsed timer,
and a pulsing placeholder opponent avatar.

**What the user can do:** Cancel by leaving the screen.

**User experience:** If the connection briefly drops while waiting, the app
automatically rejoins the queue so the player isn't silently stranded. After
about 25 seconds the player can opt to search other time controls too. When an
opponent is found, both players are taken straight into the game.

### Game Room (Private)

**Purpose:** Create or join a private game by code.

**What the user sees:** A create path that produces a six‑character room code
with a copy button and a pulsing "waiting for a friend" state, and a join path
with a code entry field.

**What the user can do:** Create a room and share the code, or paste/enter a
code to join. Invalid or expired codes show a clear error.

**User experience:** As soon as the second player joins, both are dropped into
the match.

### Bots

**Purpose:** Choose a computer opponent.

**What the user sees:** Six named characters, each with a star rating for flavor
and a real difficulty level, plus a "Match Options" row.

**What the user can do:** Pick an opponent; open Match Options to set which color
to play, the time control, and the venue.

**User experience:** Match Options resets to a default each visit; the choices
ride along into the game.

### Match (Live Game)

**Purpose:** The actual chess game — for computer, local, and online play.

**What the user sees:** A header with the app name and a venue badge; an
opponent bar (avatar, name, a rank label, clock, and captured‑piece tray); the
board; the player's own bar mirrored below; and an action row (Chat, Resign,
and Draw). The venue's backdrop and accent lighting sit behind everything.

**What the user can do:** Move pieces by tapping or dragging; resign; offer or
respond to a draw (not against the computer); chat (online only); and, when
promoting a pawn, choose which piece to promote to.

**User experience:** Detailed in sections 6 and 13. The clock is a real
countdown. When the game ends, the final position is held on screen for a
moment before the result screen takes over. The opponent's rating and title are
real, and tapping the opponent opens their profile. Against a Tour boss with a
Roadie Kit, the action row shows the take‑back and hint buttons instead of
Chat.

### Puzzle

**Purpose:** Solve one tactics puzzle.

**What the user sees:** An information card with the puzzle's title, rating, and
tactic tags, plus a status line ("Find the best move for white", "Solved!", "Not
quite — try again", or "Solution"); the board; and an action row.

**What the user can do:** Attempt the solution move by move; use **Hint** to
highlight the piece to move; use **Give Up** to watch the solution play out.
After solving or giving up, move on to the next puzzle or retry.

**User experience:** Wrong attempts never disturb the position. A solve is
recorded locally and also counts toward the daily puzzle quest.

### Result

**Purpose:** Show the outcome of a finished game.

**What the user sees:** A large outcome banner (Victory / Draw / Defeat) in an
outcome‑specific color with a matching glow, the specific reason underneath
(for example "by Checkmate", "by Repetition", "by Timeout"), a count‑up of
reward chips, and action buttons.

**What the user can do:** Offer or accept a rematch, replay the game, buy a full
analysis (or use a stored review), or go Home. The screen also shows the Show
Report (Fame, level, rating change, goals moved), the chip result of a wagered
game, and after a Festival set the choice to bank the purse or play on. Tapping
the opponent opens their profile.

**User experience:** A clean, celebratory (or consoling) close to the game.

### Replay / Analysis Board

**Purpose:** Review a finished game and optionally get a computer analysis.

**What the user sees:** The board with transport controls (previous, next,
play), a move list, and — once analysis is run — an evaluation bar and
per‑move quality labels (best, good, inaccuracy, mistake, blunder, with a skull
icon for blunders).

**What the user can do:** Step through the game; run a paid analysis.

**User experience:** Already‑loaded content is not blanked out if a background
refresh fails.

### Iron ID (Profile)

**Purpose:** The player's full profile.

**What the user sees:** Avatar and name, a rating card, win/loss/draw stats, a
level/experience bar, currency, the player's friend code, a trophy case, and a
match history list. Cards for Friends and Messages show pending‑request and
unread badges.

**What the user can do:** Edit the profile, open Friends / Messages / Spectate,
open Achievements / Quests / Collections, copy the friend code, and tap any past
match to replay it.

**User experience:** The screen has four clean states — loading, ready, an error
state, and a "you're a guest, sign in" state — so it never shows fake data to a
guest.

### World Rankings (Leaderboard)

**Purpose:** See where the player stands.

**What the user sees:** Filter tabs (Global, Friends, Venue, Country), a podium
for the top three, a ranked list, and the player's own row pinned.

**What the user can do:** Switch between Global and Friends; add a ranked player
as a friend inline. Venue and Country show "Coming Soon".

### Friends

**Purpose:** Manage friends.

**What the user sees:** The friend list with status‑colored avatars (online, in
a game, offline), incoming/outgoing requests, and an add‑by‑code field.

**What the user can do:** Add, accept, decline, or remove friends; challenge a
friend to a game; open a message thread.

**User experience:** Guests see a sign‑in prompt instead.

### Messages

**Purpose:** Private text chat with friends.

**What the user sees:** A conversation list with unread badges and presence
dots, and a thread view with chat bubbles.

**What the user can do:** Open a conversation and send messages; history loads
and new messages appear live.

### Spectate ("Front Row")

**Purpose:** Watch a live game.

**What the user sees:** The live board and clocks, a "LIVE" badge, floating
emoji reactions, and a scrolling comment ticker.

**What the user can do:** Watch the game update in real time and tap reaction
emojis.

### Puzzles (Library)

**Purpose:** Browse and pick puzzles.

**What the user sees:** A difficulty selector, tactic filter chips, a progress
strip ("X of total solved"), a "Continue Training" button, and a long scrollable
list grouped by rating band.

**What the user can do:** Filter the list, jump to the next unsolved puzzle, or
open any puzzle.

### Shop

**Purpose:** Buy currency, Remove Ads and Backstage Gear.

**What the user sees:** Tabs for Chips, Gems, Gear and VIP; packs with prices; a
highlighted "HOT" pack; Remove Ads and a "Free Chips" ad card; the Gear bag and
Review Pack; and a persistent card that routes to the Forge.

**What the user can do:** Buy chip and gem packs and Remove Ads through Google
Play (verified by the server; Remove Ads can be restored), watch an ad for free
chips, and buy or activate Gear. **The VIP tab (Backstage Pass) is "Coming
soon".**

### Forge (Customization)

**Purpose:** Preview and equip cosmetics.

**What the user sees:** Three tabs (Boards, Pieces, Avatars) with owned and
locked items; locked items show a price.

**What the user can do:** Buy a locked item with gems or chips (confirmed
through a prompt), then equip it. Buying and equipping both work end to end.

### Collections

**Purpose:** See everything currently owned.

**What the user sees:** Owned boards, piece sets, and avatars grouped together.

**What the user can do:** Tap an owned item to equip it.

### Daily Bonus

**Purpose:** Claim a daily login reward.

**What the user sees:** A six‑day grid plus a distinct day‑seven jackpot card;
each day's icon reflects its reward type.

**What the user can do:** Claim today's reward. Guests see a sign‑in prompt.

### Spin

**Purpose:** The daily prize wheel.

**What the user sees:** A hand‑drawn segmented wheel.

**What the user can do:** Spin once per day for free, once more by watching an
ad, and up to three more times for chips. Guests see a sign‑in prompt.

**User experience:** The outcome is decided fairly first, then the wheel
animates for several seconds and lands on it, with extra rotations for effect.

### Quests

**Purpose:** Daily and weekly objectives.

**What the user sees:** A Daily tab with quest cards and progress, and a Weekly
("Tour Dates") tab that unlocks at level 5.

**What the user can do:** Claim completed quests; claimed quests get a
struck‑through, recolored title.

### Achievements

**Purpose:** Long‑term milestone badges.

**What the user sees:** A three‑column badge grid (filled with a gold/metal
gradient when unlocked) and one featured long‑form challenge card.

**What the user can do:** Claim rewards for earned achievements.

### Tournaments

**Purpose:** Placeholder for future tournaments.

**What the user sees:** A clear "Coming Soon" screen.

**What the user can do:** Nothing yet: tournaments are not built.

### Control Core (Settings)

**Purpose:** The settings hub.

**What the user sees:** A profile summary with an "Edit Profile" button, music
and sound‑effects toggles, a list of rows (Notifications with an unread badge,
Language, Terms of Service, Help & Support), and a Logout button.

**What the user can do:** Toggle audio, open Notifications / Support, log out
(confirmed through a prompt). Language and Terms are not active.

### Backstage Alerts (Notifications)

**Purpose:** The notification feed.

**What the user sees:** A list of items, each with an accent‑colored left border
and a read/unread state; claimable‑reward items carry a "Claim" action.

**What the user can do:** Open an item, mark items read, or mark all read.

### Account Security

**Purpose:** Linked accounts and account deletion.

**What the user sees:** An ID‑badge‑styled profile card, a list of social
accounts to link (Google, Facebook, Apple), and a "delete account" danger zone.

**What the user can do:** Delete the account (confirmed through a prompt). The
social‑account linking buttons are not active.

### Roadie Support

**Purpose:** Help center.

**What the user sees:** A grid of support categories (FAQ, Technical, Billing,
Report a Player) and a contact action.

**What the user can do:** Read the FAQ, email support about a technical or
billing problem (the email is pre‑filled with the app version and platform), or
report a player (a friend or a recent opponent).

---

## 6. Chess Gameplay

Chess rules in this application are handled by a well‑established chess rules
engine, used consistently on both the phone and the server. The application
itself does not re‑invent any rule — it asks the engine what is legal and
mirrors the answer. This means standard chess is implemented correctly and
completely.

**Starting a game**

* **Vs computer:** from the Bots screen, pick an opponent and (optionally) set
  color, time, and venue, then start.
* **Local:** start a pass‑and‑play game; both players use the one phone, White
  at the bottom.
* **Online:** join matchmaking, create/join a private room, or accept a friend
  challenge. Colors are assigned by a coin flip; the app orients the board so
  the player's own pieces are at the bottom.

**Making moves**

* Tap a piece to select it, then tap a destination; or drag the piece directly.
* When a piece is selected, its legal destinations are shown — a glowing dot for
  an empty square, a hollow ring for a square where something can be captured.
* Illegal moves are simply not accepted, with a distinct "illegal" sound.
* It is only ever possible to move the side whose turn it is (and, online, only
  the player's own color).

**Captures, check, checkmate, stalemate**

* Captures are handled fully, including the special "en passant" pawn capture.
  Captured pieces animate out and are added to a captured‑pieces tray next to
  the capturing player.
* Check is shown by tinting the checked king's square red, with a brief pulsing
  glow and a "check" sound.
* Checkmate ends the game, with an expanding gold ring flourish and a distinct
  sound; the winner is the side that delivered mate.
* Stalemate ends the game as a draw.

**Draws**

* The game is drawn automatically on stalemate, on insufficient material (not
  enough pieces for anyone to checkmate), on threefold repetition of the
  position, and under the fifty‑move rule.
* The result screen names the specific reason ("by Repetition", "by the 50‑Move
  Rule", "by Insufficient Material", "by Stalemate").
* Players can also agree a draw: in an online or local game, one player offers a
  draw and the other accepts. (There is no draw offer against the computer.)

**Resignation and forfeiting**

* A player can resign at any time from the action row (confirmed through a
  prompt); this counts as a loss.
* In an online game, if a player disconnects and does not return within the
  grace period, they forfeit and the opponent is awarded the win.

**Time‑out**

* If a player's clock runs out, they lose — unless the opponent could not
  possibly deliver checkmate with the pieces they have left, in which case the
  game is correctly scored as a **draw** (a standard tournament rule).

**Promotion**

* When a pawn reaches the far rank, a small chooser appears with Queen, Rook,
  Bishop, and Knight (shown in the player's equipped piece style). The player
  picks the piece; they can also cancel and reconsider the move. In puzzles, the
  chosen promotion piece must match the intended solution.

**Castling and en passant**

* Both are fully supported. Castling animates the king and rook together as one
  coordinated move.

**Turn handling and game completion**

* Turns strictly alternate. Exactly one end‑of‑game result is produced per
  game, no matter how it ends (checkmate, resignation, time‑out, forfeit,
  agreed draw, or a drawn position), and it flows into the result screen.

---

## 7. Multiplayer & Online Gameplay

**Finding an opponent**

* **Quick match / matchmaking:** the player joins a queue for a chosen time
  control (and, from Setup, a venue tier) and is paired with the next player
  waiting on the same clock at that venue. Both are dropped straight into the
  game. Paid venues hold both buy‑ins in escrow from the moment of pairing.
* **Private room:** one player creates a room, shares a six‑character code, and
  the other joins with it.
* **Friend challenge:** from the friends list, a player challenges an online
  friend directly; the friend accepts or declines a prompt.

**Playing the game**

* Moves are sent to the server, checked for legality there, and then delivered
  to both players, so the two screens stay in agreement. The player's own move
  appears instantly on their screen for responsiveness and is confirmed by the
  server a moment later.
* Both clocks are kept by the server, so the time shown is authoritative and
  can't be manipulated by either device.

**Connection handling**

* If a player leaves the match screen mid‑game, the app resigns on their behalf
  so the opponent isn't left waiting.
* If a player's connection drops, the opponent is told, and a countdown to
  forfeit begins. If the player reconnects in time, the match resumes exactly
  where it was (position and clocks intact) and both players are notified.
* If a player's move is somehow out of step with the server, the app quietly
  snaps their board back to the correct position rather than letting the game
  desync.

**Chat**

* The two players can exchange short chat messages during the game. Messages are
  filtered and rate‑limited.

**When a match ends**

* Both players see the result screen with the outcome and reason.
* For rated online games between two registered accounts, the result is saved:
  each player's rating is updated, win/loss/draw and streak counts change, Fame
  and chips are granted (at a paid venue the winner takes the pot instead of the
  flat chip reward), the full game is stored for replay, and a
  "match ended" notification is created for each player. Saving happens after
  the result is shown, so a storage hiccup never delays or breaks the game
  itself.
* Guest‑involved games play identically but are not saved or rated. Friendly
  games (friend challenges and private rooms) are saved for history but are
  unrated and pay no rewards.

**Spectating**

* A live game can be opened and watched in real time by another user.

---

## 8. Game Clock & Time Controls

The application has a **real chess clock**.

* **Time controls:** three real options — 3, 5, and 10 minutes per player. (The
  Play screen also shows Bullet / Blitz / Rapid / Classical labels, but these
  map onto the three real limits.) Computer and local games default to 5
  minutes unless another duration is chosen.
* **How it behaves:** each side has its own countdown. The clock for the side to
  move ticks down; when they move, their clock stops and the opponent's starts.
* **When it starts:** White's clock is running from the first move, following
  normal chess convention.
* **Accuracy:** the display is derived from real elapsed time rather than a
  simple tick counter, so it doesn't drift over a long game, and the moment a
  clock hits zero is timed precisely. In online games the server's clock is the
  source of truth and the phone re‑syncs to it on every move.
* **Running out:** the player whose time expires loses — except where the
  opponent has too little material to ever checkmate, which is scored as a draw.
* **Increment / delay:** the system is built to support a per‑move time
  increment, but no option currently offers one, so today every game is a plain
  countdown with no increment.
* **How remaining time is shown:** each player's bar has a time "pill". It stays
  neutral normally, turns amber under 30 seconds, and turns red with a gentle
  pulsing animation under 10 seconds on the side that is actively ticking. When
  the game ends, both clocks freeze immediately.
* **Disconnecting does not pause the clock** in online games — matching standard
  online‑chess convention.

---

## 9. User Accounts & Profiles

**Registration and login**

* Accounts use an email address and a password. Registration leads into a short
  onboarding flow (avatar and stage name) and a welcome screen.
* Login for a returning player goes straight to Home.
* Logging in is remembered between sessions. If a saved session is no longer
  valid, the app returns the player to the sign‑in screen on next launch.

**Guest play**

* "Continue as Guest" lets someone use the app without an account. Guests can
  play all game modes, but nothing is saved — no rating, no history, no
  friends, no rewards. Guest‑only screens (daily bonus, spin, profile) show a
  sign‑in prompt.

**Logout and deletion**

* Logout clears the saved session and returns to the sign‑in screen.
* "Delete Account" permanently removes the account and its data after a
  confirmation prompt.

**The profile ("Iron ID") contains**

* Avatar and display name (both chosen by the player and changeable).
* A skill rating.
* Win, loss, and draw counts, and a current win streak.
* A level and an experience bar.
* Chip and gem balances.
* A personal friend code for others to add them.
* A trophy case (currently a visual showcase).
* A match history of past online games, each tappable to replay.

---

## 10. Ratings, Progress & Competition

**Skill rating**

* Every account starts at a standard baseline rating.
* After each online game between two registered players, both ratings are
  adjusted: you gain more for beating a higher‑rated player and less for beating
  a lower‑rated one, and lose correspondingly. The method is a standard, widely
  used rating formula tuned so ratings move meaningfully after a handful of
  games without swinging wildly on a single result.
* Rating is not affected by games against the computer, local games, or games
  involving a guest.

**Leaderboard**

* A global ranking orders all players by rating, with a top‑three podium and the
  player's own position pinned. A Friends view ranks just the player's friends.
* Venue and Country leaderboards are planned but shown as "Coming Soon".

**Win/loss/draw and streaks**

* Tracked per account and shown on the profile. A win streak counter resets on
  any non‑win.

**Fame, levels and titles**

* Wins grant Fame that raises the account level along a set curve (draws give a
  small amount; losses give none). Bot wins pay by difficulty, with a daily cap;
  the first win of the day and win streaks pay bonuses. Each level pays a
  one‑time reward and milestone levels unlock titles.

**Match history**

* Each saved online match records the result, the reason, the opponent, the
  rating change, and the full game for replay.

**Rewards and daily loops**

* **Daily bonus:** a seven‑day streak of escalating rewards.
* **Spin:** one fair prize‑wheel spin per day.
* **Quests:** daily objectives driven by real gameplay (wins, captures,
  checkmates, puzzles solved), plus weekly quests from level 5, each claimable
  when complete.
* **Achievements:** permanent milestone badges across many categories (win
  totals, streaks, rating targets, wins as each color, flawless wins, long and
  short games, puzzle counts, bot wins, and more).

How this shapes the experience: playing regularly steadily raises the player's
rating, level, and record, fills in achievements, and keeps daily rewards
flowing. Losing only costs chips when the player chose a paid venue or a
Festival entry, so the free path stays approachable.

---

## 11. Social Features

**Friends**

* Add friends by entering their friend code.
* See each friend's real‑time presence: online, in a game, or offline.
* Send, accept, and decline friend requests.
* Per friend: challenge them to a game, open a message thread, or remove them.

**Direct messages**

* Real private one‑to‑one conversations with friends, independent of any game.
* Message history is saved and loads when a thread is opened; new messages
  arrive live; unread counts are shown on the profile and in the conversation
  list.
* Messaging is limited to friends and messages are filtered and rate‑limited.

**Friend challenges**

* A direct game invitation to an online friend with a chosen time control,
  accepted or declined through a prompt, that drops both players into the game.

**In‑game chat**

* Short messages between the two players during an online match.

**Spectating**

* Open a live game and watch it in real time, with reaction emojis and a comment
  ticker.

**Player profiles and the leaderboard**

* Ranked players on the leaderboard can be added as friends inline.

**Notifications**

* Friend requests, friend challenges, and match results all generate
  notification‑feed entries.

---

## 12. Visual Design & UI Theme

**Overall style**

The application commits fully to one look: a **dark, "backstage arena"
aesthetic** — think a concert stage at night rendered in brushed metal and
neon. It is polished and characterful rather than plain or utilitarian, and it
is completely consistent across every screen. There is no light mode.

**Color**

* **Backgrounds** are a deep, warm near‑black, with slightly lifted dark panels
  for cards and bars.
* **Accent colors** carry meaning: a warm orange for energy and primary calls to
  action, gold for rewards and currency, cyan for interactive and selected
  states, and red for anything destructive (resign, delete).
* **Metallic grays** are used for borders, inactive controls, and tracks.
* Translucency is used heavily and subtly — glows, tints, and scrims are all
  derived from the accent colors rather than being separate flat colors.

**Depth and surfaces**

Panels and buttons are never flat fills. Each "glossy" surface is built from a
base gradient, a soft top highlight, sometimes an inner glow, and a fine bright
edge line — plus a colored outer glow keyed to the element's accent. The result
reads as lit metal and glass. Corners are softly rounded (roughly 8–15 pixels),
and pill shapes are used for tags, currency chips, and circular buttons.

**Typography**

Three typefaces do all the work:

* A tall, condensed display face for big headline numbers and titles.
* A condensed semibold face for buttons, section labels, currency values, and
  navigation — giving the interface its "poster / marquee" feel.
* A clean, neutral face for body text and captions.

Headings lean uppercase with wide letter spacing, reinforcing the concert‑poster
identity.

**Iconography**

A consistent icon set is used throughout, with accent‑colored icons inside small
rounded tiles for list rows and shortcuts.

**Motion**

* Reward numbers and balances count up rather than snapping into place.
* "Live", "waiting", and "your turn" states use gentle pulsing glows.
* The prize wheel spins with a weighty, multi‑rotation animation.
* Buttons visibly press in and spring back.
* Screens have faint ambient light behind the content.

The chessboard has its own, more elaborate animation system (see section 13).

**Sound**

* Six short sound effects (move, capture, castle, check, checkmate, and an
  "illegal" cue), each matched to what just happened on the board.
* A single looping ambient music track plays on all menu screens and stops
  during an actual game.
* Both music and sound effects can be turned off in Settings, and the choice is
  remembered.

**Consistency conventions**

* Buttons that trigger a background action disable themselves and change their
  label to a progress word ("Creating…", "Equipping…", "Spinning…").
* Locked items everywhere get the same treatment: dimmed, a lock glyph, and a
  price shown instead of the normal action.
* Destructive or paid actions are always confirmed with a prompt.
* Screens that need a sign‑in swap their whole body for a sign‑in prompt rather
  than showing empty or fake data.

**Responsiveness**

The interface is built for phones and adapts to different phone screen sizes,
notches, and the on‑screen gesture bar. See section 14.

---

## 13. Chessboard & Game Interface Design

**The board**

* A standard 8×8 board. Square colors are not a single flat pair — the shading
  varies subtly by rank, so the board reads as a real surface catching stage
  light, brightest across the middle and falling off toward the near edge. The
  frame is a darker metal edge.
* When the player has the black pieces, the whole board flips so their own
  pieces are always at the bottom, with piece art and any labels kept upright.

**The pieces**

* Detailed, sculpted‑looking piece artwork with a soft contact shadow under each
  piece so it appears to stand on the square rather than be printed on it.
* The player can change the piece style (and the board style) through the Forge;
  whatever is equipped is what appears in every game, puzzle, and replay.

**On‑board information**

* **Selected piece:** its square is highlighted.
* **Legal moves:** a glowing dot on each empty destination, a hollow ring on
  each square where a capture is available.
* **Last move:** the from‑ and to‑squares of the most recent move are
  highlighted.
* **Check:** the checked king's square is tinted red with a short pulsing glow.
* **Checkmate:** an expanding gold ring flourish over the board.

**Move animation**

* Each piece keeps its identity for its whole life on the board — moving it
  slides the same piece, it never blinks or redraws.
* Different move types feel different: a normal move glides, a capture lands more
  sharply, castling moves king and rook together as one gesture, and a promotion
  pops with a scale pulse. Captured pieces fade, shrink, and get knocked back
  rather than vanishing.
* The player's own tap moves settle quickly (the tap already implied the
  motion); the opponent's and the computer's moves play the fuller travel
  animation so they're easy to follow.
* Dragging lifts the piece well above the fingertip so the destination stays
  visible; an illegal drop springs the piece back home.

**Player information**

* Each player has a bar with their avatar, name, a rank label, their clock, and
  a tray of the pieces they have captured.
* The active player's clock pill glows; it turns amber then red as time gets
  short.
* The rank text on these bars shows the opponent's real rating and title (or the
  bot's strength label).

**Game controls**

* A compact action row holds Chat (online only), Resign, and Draw (not against
  the computer). In puzzles the row instead offers Hint and Give Up, switching
  to Retry / Next Puzzle once solved.
* Resigning and other decisive actions are confirmed with a prompt.

**Game status and end**

* Puzzles show a clear status line that reacts to the player's progress.
* When a game ends, the final position is held on screen briefly before the
  result screen slides in with the outcome, the specific reason, and a reward
  count‑up.

**Keeping the player focused**

The match screen is deliberately sparse — two player bars, the board, one small
action row. The venue theming sits behind the board as atmosphere without
competing with it. Sound and animation are tied to the same underlying events,
so what the player hears and sees always agree.

---

## 14. Responsive & Device Experience

**Platform**

This is a **mobile application for iOS and Android phones**, built with a
cross‑platform mobile framework. It runs in portrait orientation.

**Phone sizes**

* Layouts use flexible sizing and adapt to different phone screen dimensions.
* Every screen accounts for the notch / status bar area, the home‑indicator /
  gesture bar, and the bottom navigation, so content is never hidden behind
  system UI.
* The chessboard is sized to a whole number of pixels and scales to the
  available width, so squares stay perfectly even and file lines don't drift on
  any device.
* Long lists (the puzzle library, match history, leaderboards) are virtualized
  so they stay smooth even with thousands of entries.
* Text inputs lift above the on‑screen keyboard rather than being covered by it.

**Tablets and desktop**

* There is **no dedicated tablet or desktop layout**. The framework can run the
  app on a tablet, but the design is tuned for phone screens.
* A web build is configured in the project settings, but the product as designed
  and tuned is a phone app; a polished desktop/browser experience is not part of
  the current implementation.

**Offline behavior**

* Playing the computer, local pass‑and‑play, and the puzzle trainer all work
  with no internet connection.
* Online play, accounts, friends, messaging, leaderboards, and reward claims
  require a connection to the game service.

---

## 15. User Journey

**First‑time player**

1. Opens the app; a short branded intro animation plays, then the sign‑in
   screen appears.
2. Chooses to create an account (or continue as a guest).
3. If registering: enters an email and password, picks an avatar and a stage
   name, and sees a short welcome screen.
4. Arrives at Home, where their starting chip balance is shown.
5. Taps a mode — for example "Bots" — picks an opponent, optionally sets color
   and time, and starts.
6. Plays the game on the board by tapping or dragging pieces, with the clock
   running.
7. The game ends; the final position holds for a moment, then the result screen
   shows the outcome, the reason, and a reward.
8. From there, offers a rematch, replays the game, runs an analysis, or returns
   Home.

**Returning player, online game**

1. Opens the app and is taken straight to Home (still signed in).
2. Opens Play and taps "Find Match" at a chosen speed.
3. Waits on the matchmaking screen until an opponent is found.
4. Plays the live game; moves appear on both screens in real time and the
   server keeps both clocks.
5. The game ends; the result is saved — rating change, record, experience,
   chips, match history entry, and a notification.
6. Checks the leaderboard or profile to see the updated rating and record.

**Other common journeys**

* **Puzzles:** Home or Play → Puzzles → pick a tier or "Continue Training" →
  solve a puzzle → next puzzle, with progress tracked.
* **Social:** Profile → Friends → add a friend by code → challenge them → play →
  message them afterward.
* **Customization:** Shop → Forge → buy a board or piece set with gems or chips →
  equip it → it now appears in every game.
* **Daily check‑in:** Home → claim the daily bonus → spin the wheel → claim any
  completed quests.

---

## 16. Game States & Edge Cases

The application communicates a wide range of states to the player:

* **Loading:** screens that fetch data show a loading state only when there is
  nothing cached yet; a background refresh that fails does not blank
  already‑visible content.
* **Guest / not signed in:** guest‑only screens (profile, daily bonus, spin,
  friends) replace their content with a clear sign‑in prompt.
* **Session expired:** a saved login the service no longer accepts is cleared,
  and the player is returned to the sign‑in screen on next launch.
* **Searching for an opponent:** an explicit "Searching…" screen with an elapsed
  timer.
* **Match found:** both players are moved straight into the game.
* **Waiting in a private room:** a pulsing "waiting for a friend" state with the
  shareable code.
* **Opponent disconnected / reconnecting:** the player is told their opponent
  dropped, a forfeit countdown runs, and if the opponent returns in time the
  game resumes and both are notified.
* **Your connection dropped:** the app automatically tries to rejoin the game
  (or the matchmaking queue) when the connection returns.
* **Move out of sync (online):** the board quietly snaps back to the correct
  server position.
* **Illegal move attempt:** the move is refused with a distinct sound; nothing
  on the board changes.
* **Game won / lost / drawn:** a color‑coded result banner with the specific
  reason and a reward count‑up.
* **Resignation / time‑out / forfeit / agreed draw:** each is handled as its own
  end condition and named on the result screen.
* **Time‑out with insufficient material:** correctly shown as a draw rather than
  a loss.
* **Empty states:** e.g. no friends yet, no match history yet, no notifications —
  shown as clean empty states rather than errors.
* **Invalid room code:** a clear, specific error ("Room not found or expired",
  "You can't join your own room").
* **Not enough currency:** a dedicated "insufficient funds" message on a
  purchase attempt.
* **Network / service error:** screens that can't reach the service show an
  error state, and destructive network actions are wrapped so a failure is
  reported rather than crashing anything.

---

## 17. Overall Product Experience

**Strongest aspects**

* **The chess is genuinely solid.** Rules, endings, special moves, promotion
  choice, draw conditions, and the tournament‑correct time‑out rule are all
  handled properly, and the same engine runs on the phone and the server, so
  online games can't be cheated with illegal moves.
* **Online play is real and complete.** Matchmaking, private rooms, direct
  friend challenges, live move sync, a server‑authoritative clock, resign, draw
  offers, disconnect handling with reconnection, in‑game chat, and spectating
  all work together as one coherent multiplayer experience.
* **The board itself is a highlight.** The animation and sound system makes every
  move feel deliberate and readable, and it never flickers or jumps.
* **A strong, consistent visual identity.** The "backstage arena" theme is
  carried through every screen with real attention to depth, lighting, and
  typography, so the app looks like a designed product rather than a template.
* **A full progression layer.** Rating, levels, match history, a puzzle trainer
  with analysis, friends and messaging, a leaderboard, and daily reward loops
  give the app long‑term shape beyond a single game.

**How it holds together**

* The navigation is built around Home, so the player always has a clear way
  back, and the bottom bar keeps the five main areas one tap apart.
* The reward loops and social features are woven into the main screens (Home's
  daily row, the profile's social cards, inline "Add Friend" on the leaderboard)
  rather than hidden away.
* Play, profile, and competition reinforce each other: playing raises the
  rating and level shown on the profile, fills the match history that feeds
  replay and analysis, and advances quests and achievements.

**Current limitations to be aware of**

* **Tournaments and the Backstage Pass (VIP) are "Coming Soon".**
* **Some secondary items are placeholders:** the language selector, the Terms
  row in Settings, "Forgot Password", social‑account linking (the linked
  accounts shown are sample data), the Venue and Country leaderboards, and the
  trophy case.
* **No push notifications yet** — alerts appear inside the app only.
* **Ads run on Google's test ads** until the real ad account is set up.
* **Android only for real‑money purchases**; iOS is not prepared for release.
* **No dedicated tablet or desktop layout** — the product is designed for phones.
* A known stability problem on some low‑end Android phones (the game screen can
  freeze when a match starts) is under investigation.

None of these affect the core loop: playing correct, well‑presented chess —
against the computer, a friend, or a matched opponent online — with a saved
rating, history, and progression.

---

## 18. Feature Summary

| Area | Features |
|---|---|
| **Gameplay** | Full standard chess rules; play vs. 6 named computer opponents on 5 levels (2 custom engine tiers + 3 professional‑engine tiers ~club/expert/master); The Tour campaign with boss bots; Festival Run bot ladder; local pass‑and‑play; tap or drag to move; legal‑move indicators; last‑move and check highlighting; captured‑piece trays; castling, en passant, and a promotion‑piece chooser; checkmate / stalemate / resignation / agreed draw / repetition / 50‑move / insufficient‑material endings; move and result sound effects; animated board |
| **Multiplayer** | Real‑time online matches; automatic matchmaking by time control and venue tier; chip wagers at paid venues; rematch; private rooms via 6‑character code; direct friend challenges (friendly, unrated); server‑verified moves; in‑game chat; live spectating; disconnect grace period with full reconnection; auto‑resign on leaving |
| **User Accounts** | Email/password sign‑up and sign‑in; guest mode; onboarding (avatar + stage name); editable display name and avatar; logout; permanent account deletion; session remembered between launches |
| **Competition** | Skill rating (standard formula, online games between accounts); global and friends leaderboards with podium and pinned self; win/loss/draw records and win streaks; levels and experience; saved match history with replay; paid computer analysis with move‑quality labels and an evaluation bar |
| **Social** | Friends with real‑time presence (online / in‑game / offline); friend requests; add by friend code; direct friend challenges; private 1‑to‑1 messaging with saved history and unread counts; notification feed for social and match events; reaction emojis while spectating |
| **Progress & Rewards** | Fame, levels, level rewards and titles with a post‑match Show Report; puzzle trainer (~250 puzzles, 5 tiers, tactic filters, hints, give‑up, local progress); 7‑day daily bonus; prize wheel (free, ad and chip spins); daily and weekly quests; achievement badges |
| **Customization** | 5 board themes, 4 piece sets, 77 avatars in 3 classes; buy with in‑game currency and equip; owned‑items "Collections" view; equipped board and pieces appear in every game |
| **UI / Design** | Single fixed dark "backstage arena" theme; meaningful accent colors (orange / gold / cyan / red); layered gradient‑and‑glow surfaces with soft rounded corners; three‑typeface system with poster‑style headings; consistent icon language; count‑up numbers, pulsing "live" states, pressable buttons; ambient background music plus six board sound effects; consistent locked‑item, in‑progress, and confirmation patterns |
| **Settings** | Music and sound‑effects toggles (remembered); notifications with unread badge; account summary and "Edit Profile"; help center; logout; delete account |
| **Responsive Experience** | Phone‑first (iOS and Android), portrait; adapts to different phone sizes, notches, and gesture bars; board scales cleanly to screen width; long lists virtualized; keyboard‑aware inputs; offline support for computer, local, and puzzle play; no dedicated tablet or desktop layout |

---

## Notes on Accuracy

* This document is based on a direct review of the application's code, last
  updated on 23 October 2026.
* Features are described as **working** only where the code implements them end
  to end. Where a screen exists but its actions are not connected to real
  functionality (tournaments, the Backstage Pass, and the placeholder items
  listed in section 17), that is stated explicitly rather than implied to be
  finished.
* Where a number or label in the interface is decorative (the trophy case),
  that is noted rather than presented as a live feature.
* The underlying chess rules, the online multiplayer system, accounts and
  profiles, ratings, match history, puzzles, friends, messaging, the leaderboard,
  daily bonus, spin, quests, achievements, cosmetic purchase/equip, game replay
  with paid analysis, The Tour, Festival Run, venue wagers, Fame and levels,
  rematch, real‑money purchases and ads are all implemented and functional based
  on the code.

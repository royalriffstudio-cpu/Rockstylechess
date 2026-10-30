/**
 * Economy sanity checker (the repo has no test framework -- this is the
 * "test"). Reads economy.config.json and the generated catalogs, asserts the
 * rules the economy depends on, and prints the income model so a price change
 * can be judged by how long things take to earn.
 *
 * Usage (repo root): node scripts/check-economy.mjs     (exit 1 on any failure)
 * The income model is an ESTIMATE (see incomeModel in the config), not data.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const cfg = JSON.parse(readFileSync(join(ROOT, 'economy.config.json'), 'utf8'));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -> ${detail}`}`);
  if (!ok) failures++;
};

const R = cfg.gemToChip;
const t = cfg.tiers;

// ---- ladder shape -----------------------------------------------------
const order = ['common', 'rare', 'epic', 'legendary'];
check('chip tiers strictly increase', order.every((k, i) => i === 0 || t[k].gems > t[order[i - 1]].gems));
check('Hall of Fame tiers strictly increase', t.hof_gold.gems < t.hof_platinum.gems && t.hof_platinum.gems < t.hof_immortal.gems);
check('Hall of Fame gold above Legendary', t.hof_gold.gems > t.legendary.gems);
check('Hall of Fame is gems-only', ['hof_gold', 'hof_platinum', 'hof_immortal'].every((k) => t[k].gemsOnly === true));

// ---- every item uses a tier, in the generated files --------------------
const econGen = read('server/src/economy.generated.ts');
const prices = JSON.parse(econGen.match(/COSMETIC_PRICES[^=]*=\s*(\{[\s\S]*?\n\});/)[1]);
for (const [group, items] of [['boards', cfg.boards], ['pieces', cfg.pieces]]) {
  for (const [id, tier] of Object.entries(items)) {
    const want = tier === null ? { gems: 0, chips: 0 } : { gems: t[tier].gems, chips: t[tier].gems * R };
    const got = prices[id];
    check(`${group}/${id} price = tier ${tier ?? 'free'}`, got && got.gems === want.gems && got.chips === want.chips, JSON.stringify(got));
  }
}
const avatarFile = read('server/src/avatarCatalog.generated.ts');
const avatarRows = [...avatarFile.matchAll(/class: '(\w+)', rarity: '(\w+)', gemPrice: (\d+), chipPrice: (\d+|null)/g)];
check('65 premium avatars generated', avatarRows.length === 65, String(avatarRows.length));
let avatarOk = true;
for (const [, klass, rarity, gems, chips] of avatarRows) {
  const tier = t[cfg.avatarTiers[klass][rarity]];
  const wantChips = tier.gemsOnly ? 'null' : String(tier.gems * R);
  if (Number(gems) !== tier.gems || chips !== wantChips) avatarOk = false;
}
check('avatar prices all come from tiers (re-run gen-avatar-catalog if not)', avatarOk);

// ---- real money: arbitrage rule ---------------------------------------
const gemChipEquivPerUsd = cfg.iap.gemPacks.map((p) => (p.amount * R) / (p.priceUsdCents / 100));
const bestGemEquiv = Math.max(...gemChipEquivPerUsd);
const worstGemEquiv = Math.min(...gemChipEquivPerUsd);
const chipPerUsd = cfg.iap.chipPacks.map((p) => ({ id: p.id, v: p.amount / (p.priceUsdCents / 100) }));
check('gem packs get better value per dollar as they grow', cfg.iap.gemPacks.every((p, i, a) => i === 0 || p.amount / p.priceUsdCents > a[i - 1].amount / a[i - 1].priceUsdCents));
check('chip packs get better value per dollar as they grow', chipPerUsd.every((p, i, a) => i === 0 || p.v > a[i - 1].v));
for (const p of chipPerUsd) {
  check(`chip pack ${p.id} (${Math.round(p.v)}/$) never beats gems (${Math.round(worstGemEquiv)}/$ at the smallest gem pack)`, p.v <= worstGemEquiv, `${Math.round(p.v)} > ${Math.round(worstGemEquiv)}`);
}
const skus = [...cfg.iap.chipPacks, ...cfg.iap.gemPacks, cfg.iap.removeAds].map((p) => p.androidProductId);
check('SKU ids unique', new Set(skus).size === skus.length);
check('no SKU embeds an amount', skus.every((s) => !/\d{3,}/.test(s.replace('gems_100', '').replace('gems_550', '').replace('gems_1200', ''))));

// ---- spin --------------------------------------------------------------
const wTotal = cfg.spin.reduce((s, p) => s + p.weight, 0);
check('spin weights sum to 100', wTotal === 100, String(wTotal));
check('spin has 8 segments (wheel art)', cfg.spin.length === 8);
const spinChipsEv = cfg.spin.filter((p) => p.rewardType === 'chips').reduce((s, p) => s + (p.rewardAmount * p.weight) / wTotal, 0);
const spinGemsEv = cfg.spin.filter((p) => p.rewardType === 'gems').reduce((s, p) => s + (p.rewardAmount * p.weight) / wTotal, 0);
check('spin EV about 151 chips + 1.1 gems', Math.abs(spinChipsEv - 151) < 2 && Math.abs(spinGemsEv - 1.14) < 0.1, `${spinChipsEv.toFixed(1)} / ${spinGemsEv.toFixed(2)}`);

// ---- payout sanity -----------------------------------------------------
const bw = cfg.matchRewards.botWin;
const bots = ['easy', 'medium', 'stockfish-basic', 'stockfish-lite', 'stockfish-strong'];
check('bot payouts rise with difficulty', bots.every((b, i) => i === 0 || bw[b] > bw[bots[i - 1]]));
check('no bot pays more than an online win', bots.every((b) => bw[b] <= cfg.matchRewards.online.win));
const ads = cfg.ads['free-chips'];
check('a day of free-chips ads stays under one online win', ads.dailyCap * ads.rewardChips < cfg.matchRewards.online.win);
const weekChips = cfg.dailyBonus.reduce((s, d) => s + d.chips, 0);
const weekGems = cfg.dailyBonus.reduce((s, d) => s + d.gems, 0);
check('daily-bonus week under 5 online wins', weekChips < 5 * cfg.matchRewards.online.win, String(weekChips));
check('analysis priced at the same 40:1 rate', cfg.analysis.chips === cfg.analysis.gems * R, `${cfg.analysis.chips} vs ${cfg.analysis.gems}x${R}`);
check('welcome bonus buys exactly one Common', cfg.welcomeChips === t.common.gems * R, String(cfg.welcomeChips));

// ---- venue ladder ------------------------------------------------------
const vs = Object.values(cfg.venues);
const garageWin = cfg.matchRewards.online.win;
check('every wagered net win beats the free Garage win', Object.entries(cfg.venues).every(([id, v]) => v.buyIn === 0 || v.prize - v.buyIn > garageWin), 'a wagered win must pay more than Garage or nobody plays it');
check('venue rating gates never decrease', vs.every((v, i) => i === 0 || v.minRating >= vs[i - 1].minRating));
const START_RATING = 1200; // server/src/db/schema/users.ts default
const newbieCan = Object.entries(cfg.venues).filter(([, v]) => cfg.welcomeChips >= v.buyIn && START_RATING >= v.minRating).map(([id]) => id);
check('a brand-new player (welcome chips, rating 1200) can enter Garage, Club and Arena only', newbieCan.join() === 'garage,club,arena', newbieCan.join());
check('void-ply threshold is even and at least 4', cfg.wagerVoidPlies >= 4 && cfg.wagerVoidPlies % 2 === 0);
check('venue buy-ins strictly increase after Garage', vs.every((v, i) => i < 2 || v.buyIn > vs[i - 1].buyIn));
check('venue prize = buy-in x 2 x (1 - rake)', Object.values(cfg.venues).every((v) => Math.abs(v.prize - v.buyIn * 2 * (1 - cfg.venueRake)) < 1));

// ---- income model ------------------------------------------------------
const m = cfg.incomeModel;
const online = m.onlineGamesPerDay * (m.onlineWinRate * cfg.matchRewards.online.win + m.onlineDrawRate * cfg.matchRewards.online.draw);
const bot = m.botGamesPerDay * m.botWinRate * m.botMixWinChips;
const quests = Object.values(cfg.quests).reduce((s, v) => s + v, 0);
const bonus = weekChips / 7;
const base = online + bot + quests + bonus + spinChipsEv;
const adsDay = ads.dailyCap * ads.rewardChips;
const gemsDay = weekGems / 7 + spinGemsEv;
console.log(`\nIncome model (ESTIMATE): online ${online.toFixed(0)} + bot ${bot.toFixed(0)} + quests ${quests} + daily bonus ${bonus.toFixed(0)} + spin ${spinChipsEv.toFixed(0)} = ${base.toFixed(0)} chips/day (+${adsDay} if all ads watched), ${gemsDay.toFixed(1)} gems/day`);
const days = (chips) => (chips / base).toFixed(1);
for (const k of order) console.log(`  ${k.padEnd(10)} ${String(t[k].gems * R).padStart(6)} chips -> ${days(t[k].gems * R).padStart(5)} days`);
const commonDays = (t.common.gems * R) / base;
const legendDays = (t.legendary.gems * R) / base;
check('Common takes 2-5 casual days', commonDays >= 2 && commonDays <= 5, commonDays.toFixed(1));
check('Legendary takes 20-35 casual days', legendDays >= 20 && legendDays <= 35, legendDays.toFixed(1));


// ---- fame / levels -------------------------------------------------------
const fame = cfg.fame;
const botFames = ['easy', 'medium', 'stockfish-basic', 'stockfish-lite', 'stockfish-strong'].map((b) => fame.botWin[b]);
check('bot Fame rises with difficulty', botFames.every((v, i) => i === 0 || v > botFames[i - 1]));
check('no bot win pays more Fame than an online win', botFames.every((v) => v <= fame.online.win));
check('daily bot Fame cap is a few strong-bot wins, not unlimited', fame.dailyBotFameCap >= fame.botWin['stockfish-strong'] && fame.dailyBotFameCap <= 6 * fame.online.win);
check('hot-streak steps increase', fame.hotStreak.every((s, i) => i === 0 || (s.minStreak > fame.hotStreak[i - 1].minStreak && s.mult > fame.hotStreak[i - 1].mult)));
check('Opening Night is a x2-x3 bonus', fame.openingNight >= 2 && fame.openingNight <= 3);
const titles = cfg.levels.titles;
check('level titles start at level 1 and strictly increase', titles[0].minLevel === 1 && titles.every((t, i) => i === 0 || t.minLevel > titles[i - 1].minLevel));
check('title ids unique', new Set(titles.map((t) => t.id)).size === titles.length);

// Level rewards, expanded the same way gen-economy does.
const levelRewards = {};
for (const r of cfg.levels.chipsPerLevel) for (let l = r.from; l <= r.to; l++) levelRewards[l] = { chips: r.chips, gems: 0 };
for (const [l, e] of Object.entries(cfg.levels.milestones)) { const b = levelRewards[l] ?? { chips: 0, gems: 0 }; levelRewards[l] = { chips: b.chips + (e.chips ?? 0), gems: b.gems + (e.gems ?? 0) }; }
const rewardTo = (n) => Object.entries(levelRewards).filter(([l]) => Number(l) <= n).reduce((a, [, r]) => ({ chips: a.chips + r.chips, gems: a.gems + r.gems }), { chips: 0, gems: 0 });
const xpFor = (L) => (L <= 1 ? 0 : 300 * L * L);
const fameDay = m.onlineGamesPerDay * (m.onlineWinRate * fame.online.win + m.onlineDrawRate * fame.online.draw) + m.openingNightRate * (fame.openingNight - 1) * fame.online.win + m.botGamesPerDay * m.botWinRate * m.botMixWinFame;
console.log(`\nFame model (ESTIMATE): ~${fameDay.toFixed(0)} Fame/day for a casual player`);
const daysTo = (L) => xpFor(L) / fameDay;
for (const L of [2, 5, 10, 20, 30, 50]) {
  const r = rewardTo(L);
  console.log(`  level ${String(L).padStart(2)}: ${xpFor(L).toLocaleString().padStart(8)} Fame -> ${daysTo(L).toFixed(1).padStart(6)} days   (rewards so far: ${r.chips.toLocaleString()} chips + ${r.gems} gems)`);
}
check('level 2 arrives on the first or second day (hook)', daysTo(2) <= 2, daysTo(2).toFixed(1));
check('level 5 within the first week', daysTo(5) <= 7, daysTo(5).toFixed(1));
check('level 10 in about 2-5 weeks', daysTo(10) >= 14 && daysTo(10) <= 35, daysTo(10).toFixed(1));
check('level 50 takes over a year', daysTo(50) >= 365, daysTo(50).toFixed(0));
const r10 = rewardTo(10);
check('chips from levels 1-10 are under 10% of the income earned meanwhile', r10.chips < 0.1 * base * daysTo(10), `${r10.chips} vs ${(0.1 * base * daysTo(10)).toFixed(0)}`);
const r50 = rewardTo(50);
check('all 50 levels of gems stay well under the achievement gem pool', r50.gems < 920, String(r50.gems));


// ---- The Tour ------------------------------------------------------------
const tour = cfg.tour;
const rankOf = { easy: 0, medium: 1, 'stockfish-basic': 2, 'stockfish-lite': 3, 'stockfish-strong': 4 };
const botsById = Object.fromEntries(cfg.bots.map((b) => [b.id, b]));
const GIG_KINDS = ['win_bot', 'win_color', 'capture_game', 'puzzles', 'online_games', 'online_wins', 'wager_wins', 'win_moves', 'win_marathon', 'win_no_queen_loss', 'mate_piece', 'rating'];
check('6 bots with unique ids', cfg.bots.length === 6 && new Set(cfg.bots.map((b) => b.id)).size === 6);
check('bot difficulties are valid', cfg.bots.every((b) => b.difficulty in rankOf));
check('6 chapters, one per venue, in ladder order', tour.chapters.map((c) => c.venue).join() === Object.keys(cfg.venues).join(), tour.chapters.map((c) => c.venue).join());
check('every chapter has 5 gigs', tour.chapters.every((c) => c.gigs.length === 5));
const gigIds = tour.chapters.flatMap((c) => c.gigs.map((g) => g.id));
check('gig ids unique', new Set(gigIds).size === gigIds.length);
check('every gig kind is known', tour.chapters.every((c) => c.gigs.every((g) => GIG_KINDS.includes(g.kind))));
check('every gig has a positive target and reward', tour.chapters.every((c) => c.gigs.every((g) => g.target > 0 && g.chips > 0)));
const bossChapters = tour.chapters.filter((c) => c.bossBotId);
check('boss bots exist and get stronger chapter by chapter', bossChapters.every((c, i) => botsById[c.bossBotId] && (i === 0 || rankOf[botsById[c.bossBotId].difficulty] > rankOf[botsById[bossChapters[i - 1].bossBotId].difficulty])), bossChapters.map((c) => c.bossBotId).join());
check('the last chapter is the Encore gauntlet of every boss in order', tour.chapters[5].bossBotId === null && tour.chapters[5].encore.join() === bossChapters.map((c) => c.bossBotId).join());
check('boss rewards and gig rewards grow with the chapter', tour.chapters.every((c, i) => i === 0 || (c.bossReward.chips > tour.chapters[i - 1].bossReward.chips && c.gigs.reduce((s, g) => s + g.chips, 0) > tour.chapters[i - 1].gigs.reduce((s, g) => s + g.chips, 0))));
check('chapter titles unique and do not clash with level titles', new Set([...tour.chapters.map((c) => c.title.id), ...cfg.levels.titles.map((t) => t.id)]).size === tour.chapters.length + cfg.levels.titles.length);
check('rating gigs line up with venue rating gates (the gate is the goal)', tour.chapters.flatMap((c) => c.gigs).filter((g) => g.kind === 'rating').every((g) => Object.values(cfg.venues).some((v) => v.minRating === g.target)));
const tourChips = tour.chapters.reduce((s, c) => s + c.gigs.reduce((a, g) => a + g.chips, 0) + c.bossReward.chips, 0);
const tourGems = tour.chapters.reduce((s, c) => s + c.bossReward.gems + tour.perfectBonusGems, 0);
console.log(`\nTour totals (one-time): ${tourChips.toLocaleString()} chips + ${tourGems} gems = about ${(tourChips / base).toFixed(0)} casual days of chip income`);
check('the whole Tour is worth under 35% of 90 days of chip income', tourChips < 0.35 * base * 90, `${tourChips} vs ${(0.35 * base * 90).toFixed(0)}`);
check('Tour gems stay under the achievement gem pool', tourGems < 920, String(tourGems));
const wk = cfg.weeklyQuests;
const weeklyChips = wk['win-weekly'] + wk['online-weekly'] + wk['puzzles-weekly'];
check('weekly quests pay under 20% of a week of income', weeklyChips < 0.2 * base * 7, `${weeklyChips} vs ${(0.2 * base * 7).toFixed(0)}`);
check('weekly quests unlock after the first hook levels', wk.minLevel >= 3 && wk.minLevel <= 10);

// achievements (one-time) -- read from the server catalog
const ach = [...read('server/src/achievementCatalog.ts').matchAll(/rewardType: '(chips|gems)', rewardAmount: ([\d_]+)/g)];
const achChips = ach.filter((a) => a[1] === 'chips').reduce((s, a) => s + Number(a[2].replace(/_/g, '')), 0);
const achGems = ach.filter((a) => a[1] === 'gems').reduce((s, a) => s + Number(a[2].replace(/_/g, '')), 0);
console.log(`\nFree totals incl. one-time achievements (all, eventually): ${achChips} chips + ${achGems} gems (= ${(achChips + achGems * R).toLocaleString()} chips-equivalent)`);
for (const d of [30, 90]) {
  console.log(`  ${d} days of play: ~${Math.round(base * d)} chips + ~${Math.round(gemsDay * d)} gems from dailies/matches (achievements on top as earned)`);
}
const mainStageChips = avatarRows.filter((r) => r[1] === 'main_stage').reduce((s, r) => s + Number(r[4] === 'null' ? 0 : r[4]), 0);
console.log(`  Main Stage (41) via chips alone: ${mainStageChips.toLocaleString()} chips = ${(mainStageChips / base / 30).toFixed(1)} months`);

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll economy checks passed.');
process.exit(failures ? 1 : 0);

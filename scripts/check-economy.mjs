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
// Chip-priced extra spins: every price must beat the wheel's FULL expected value, gems valued at 40:1.
const spinEvChipEq = spinChipsEv + spinGemsEv * R;
const spinPrices = cfg.spinExtra.prices;
console.log(`Paid spins: wheel EV ${spinEvChipEq.toFixed(0)} chips-equivalent per spin; prices ${spinPrices.join(' / ')} (EV is ${spinPrices.map((p) => ((spinEvChipEq / p) * 100).toFixed(0) + '%').join(' / ')} of price)`);
check('every paid-spin price is above the wheel EV, with a margin (EV <= 75% of price)', spinPrices.every((p) => spinEvChipEq <= 0.75 * p), `EV ${spinEvChipEq.toFixed(0)}`);
check('paid-spin prices strictly increase and are capped at 1-3 a day', spinPrices.every((p, i) => i === 0 || p > spinPrices[i - 1]) && spinPrices.length >= 1 && spinPrices.length <= 3);
check('even the cheapest paid spin costs more than the wheel is worth on average', spinPrices[0] > spinEvChipEq, `${spinPrices[0]} vs ${spinEvChipEq.toFixed(0)}`);
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
// Review Pack: ten reviews at once for less than ten single ones. One fixed discount step.
const pk = cfg.analysis.pack;
const packDiscount = (price, single) => 1 - price / (single * pk.reviews);
console.log(`Review Pack: ${pk.reviews} for ${pk.chips} chips (${(packDiscount(pk.chips, cfg.analysis.chips) * 100).toFixed(0)}% off, ${pk.chips / pk.reviews} each) or ${pk.gems} gems (${(packDiscount(pk.gems, cfg.analysis.gems) * 100).toFixed(0)}% off, ${pk.gems / pk.reviews} each)`);
check('a Review Pack costs less than the same number of single reviews, in chips and in gems', pk.chips < cfg.analysis.chips * pk.reviews && pk.gems < cfg.analysis.gems * pk.reviews);
check('the Review Pack discount is real but modest (10-25%)', [packDiscount(pk.chips, cfg.analysis.chips), packDiscount(pk.gems, cfg.analysis.gems)].every((d) => d >= 0.1 && d <= 0.25));
check('Review Pack chips and gems keep the 40:1 rate (no arbitrage between currencies)', pk.chips === pk.gems * R, `${pk.chips} vs ${pk.gems}x${R}`);
check('a Review Pack fits under the credit cap, with room for more than one', pk.maxCredits >= 2 * pk.reviews && pk.maxCredits <= 5 * pk.reviews);
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
// Venue refill: a lifeline for a player who cannot afford ANY paid venue.
const refill = cfg.ads['venue-refill'];
const cheapestBuyIn = Math.min(...Object.values(cfg.venues).map((v) => v.buyIn).filter((b) => b > 0));
check('a day of refill ads stays under one online win', refill.dailyCap * refill.rewardChips <= cfg.matchRewards.online.win, `${refill.dailyCap * refill.rewardChips}`);
check('one refill ad is less than the cheapest buy-in (it takes several to get back in)', refill.rewardChips < cheapestBuyIn, `${refill.rewardChips} vs ${cheapestBuyIn}`);
check('refill + free-chips ads together can cover the cheapest buy-in from zero (a broke player is not stuck)', refill.dailyCap * refill.rewardChips + adsDay >= cheapestBuyIn, `${refill.dailyCap * refill.rewardChips + adsDay} vs ${cheapestBuyIn}`);
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

// Backstage: the Roadie Kit. Help for a stuck player that must stay a sink and never a shortcut.
const bs = tour.backstage;
const kitPrice = (c) => Math.round((c.bossReward.chips * bs.kitPriceFraction) / 10) * 10;
console.log(`\nRoadie Kit prices: ${tour.chapters.map((c) => `${c.id} ${kitPrice(c)}`).join(', ')}`);
check('a loss only counts as a real attempt after 12+ plies (no resign-farming)', bs.minAttemptPlies >= 12 && bs.minAttemptPlies > tour.minBotPlies);
check('the kit opens before the free one arrives', bs.kitUnlockLosses >= 1 && bs.crowdFreeEvery > bs.kitUnlockLosses);
check('a kit costs 5-15% of its boss reward (a real sink, never a trap)', tour.chapters.every((c) => kitPrice(c) >= 0.05 * c.bossReward.chips && kitPrice(c) <= 0.15 * c.bossReward.chips));
check('the kit is small: 1-2 take-backs and 1-3 tips', bs.kit.takeTwos >= 1 && bs.kit.takeTwos <= 2 && bs.kit.tips >= 1 && bs.kit.tips <= 3);
check('one kit never costs more than one casual day of chip income at the first two chapters', kitPrice(tour.chapters[0]) < base && kitPrice(tour.chapters[1]) < base, `${kitPrice(tour.chapters[0])}/${kitPrice(tour.chapters[1])} vs ${base}`);
const wk = cfg.weeklyQuests;
const weeklyChips = wk['win-weekly'] + wk['online-weekly'] + wk['puzzles-weekly'];
check('weekly quests pay under 20% of a week of income', weeklyChips < 0.2 * base * 7, `${weeklyChips} vs ${(0.2 * base * 7).toFixed(0)}`);
check('weekly quests unlock after the first hook levels', wk.minLevel >= 3 && wk.minLevel <= 10);

// ---- Festival Run (the first repeatable chip sink) -------------------------------------------
// The purse ladders are sized with estimated win rates (incomeModel.festivalSkill, NOT
// measurements). Best strategy = bank or push on after each set, solved backwards.
const fest = cfg.festival;
const skill = cfg.incomeModel.festivalSkill;
function festivalEv(tier, profile) {
  const p = tier.sets.map((id) => skill[profile][rankOf[botsById[id].difficulty]]);
  let value = tier.purse[tier.purse.length - 1];
  for (let k = tier.purse.length - 2; k >= 0; k--) value = Math.max(tier.purse[k], p[k + 1] * value);
  return (p[0] * value) / tier.entry;
}
const festIds = fest.tiers.map((t) => t.id);
const bossOrder = tour.chapters.map((c) => c.id);
check('3 Festival tiers with unique ids', fest.tiers.length === 3 && new Set(festIds).size === 3);
check('Festival entries strictly increase', fest.tiers.every((t, i) => i === 0 || t.entry > fest.tiers[i - 1].entry));
check('Festival sets are real bots, never getting easier within a tier', fest.tiers.every((t) => t.sets.every((id) => botsById[id]) && t.sets.every((id, i) => i === 0 || rankOf[botsById[id].difficulty] >= rankOf[botsById[t.sets[i - 1]].difficulty])));
check('one purse step per set, strictly increasing', fest.tiers.every((t) => t.purse.length === t.sets.length && t.purse.every((v, i) => i === 0 || v > t.purse[i - 1])));
check('banking after the first set never beats the entry (no free money)', fest.tiers.every((t) => t.purse[0] < t.entry));
check('the top purse is at most 8x the entry', fest.tiers.every((t) => t.purse[t.purse.length - 1] <= 8 * t.entry));
check('unlock chapters exist and rise with the tier', fest.tiers.every((t, i) => bossOrder.includes(t.unlockChapter) && (i === 0 || bossOrder.indexOf(t.unlockChapter) > bossOrder.indexOf(fest.tiers[i - 1].unlockChapter))));
check('Festival titles unique and do not clash with other titles', new Set([...fest.tiers.map((t) => t.title.id), ...tour.chapters.map((c) => c.title.id), ...cfg.levels.titles.map((t) => t.id)]).size === fest.tiers.length + tour.chapters.length + cfg.levels.titles.length);
check('every tier has a daily run cap and a sane repeat surcharge', fest.tiers.every((t) => fest.dailyRuns[t.id] >= 1 && fest.dailyRuns[t.id] <= 3) && fest.repeatSurcharge > 0 && fest.repeatSurcharge <= 1);
const evRows = fest.tiers.map((t) => ({ t, casual: festivalEv(t, 'casual'), good: festivalEv(t, 'good'), strong: festivalEv(t, 'strong') }));
console.log('\nFestival expected return per chip staked (ESTIMATE, best bank/push-on strategy):');
for (const r of evRows) console.log(`  ${r.t.id.padEnd(10)} entry ${String(r.t.entry).padStart(5)}  casual ${r.casual.toFixed(2)}  good ${r.good.toFixed(2)}  strong ${r.strong.toFixed(2)}`);
const [evOpen, evMain, evHead] = evRows;
check('Open Mic is a real sink for a casual player (return 0.65-0.90)', evOpen.casual >= 0.65 && evOpen.casual <= 0.9, evOpen.casual.toFixed(2));
check('Main Set is a sink for a good player (return 0.55-0.95)', evMain.good >= 0.55 && evMain.good <= 0.95, evMain.good.toFixed(2));
check('Headliner is roughly fair for a strong player (return 0.9-1.25)', evHead.strong >= 0.9 && evHead.strong <= 1.25, evHead.strong.toFixed(2));
check('no skill level exceeds 2.5x its stake in expectation on any tier', evRows.every((r) => Math.max(r.casual, r.good, r.strong) <= 2.5));
const festDailyStrong = evRows.reduce((s, r) => {
  const runs = fest.dailyRuns[r.t.id];
  let gain = 0;
  for (let i = 0; i < runs; i++) gain += Math.max(0, r.strong * r.t.entry - r.t.entry * (i === 0 ? 1 : 1 + fest.repeatSurcharge));
  return s + gain;
}, 0);
console.log(`  best-case expected daily gain for a strong player across all tiers: ${Math.round(festDailyStrong)} chips (casual daily income ${Math.round(base)})`);
check('a strong player farming every tier gains under 3 days of casual income per day', festDailyStrong < 3 * base, `${Math.round(festDailyStrong)} vs ${Math.round(3 * base)}`);

// achievements (one-time) -- read from the server catalog
// ---- Backstage Gear (consumables) -----------------------------------------
const gear = cfg.gear;
const amp = gear.items.find((i) => i.id === 'amp-boost');
const pick = gear.items.find((i) => i.id === 'lucky-pick');
check('gear has Amp Boost and Lucky Pick with unique ids', !!amp && !!pick && new Set(gear.items.map((i) => i.id)).size === gear.items.length);
// The most chips-equivalent a booster's extra Fame can ever pay back in level rewards: the best
// reward-per-Fame level, times the extra Fame of the best possible boosted run (3 online wins).
let bestChipsPerFame = 0;
for (let L = 2; L <= 50; L++) {
  const rw = levelRewards[L] ?? { chips: 0, gems: 0 };
  const span = xpFor(L) - xpFor(L - 1);
  bestChipsPerFame = Math.max(bestChipsPerFame, (rw.chips + rw.gems * R) / span);
}
const ampExtraFame = amp.charges * gear.ampBonus * cfg.fame.online.win;
const ampMaxPayback = ampExtraFame * bestChipsPerFame;
console.log(`\nAmp Boost: extra Fame at most ${ampExtraFame}, worth at most ~${ampMaxPayback.toFixed(0)} chips-equivalent in level rewards (price ${amp.chips})`);
check('an Amp Boost never pays for itself (price >= 1.25x its best-case level-reward payback)', amp.chips >= 1.25 * ampMaxPayback, `${amp.chips} vs ${(1.25 * ampMaxPayback).toFixed(0)}`);
check('a Review Pack costs under two casual days of chip income (an impulse-sized sink)', pk.chips < 2 * base, `${pk.chips} vs ${2 * base}`);
check('gear prices are under one casual day of chip income', gear.items.every((i) => i.chips < base), String(base));
check('Amp Boost bonus is modest (<= +50% of base Fame) and stock is capped at 3-10', gear.ampBonus <= 0.5 && gear.maxStock >= 3 && gear.maxStock <= 10);
check('Lucky Pick only matters on a real streak (minStreak is the first Hot Streak step)', gear.minStreak === cfg.fame.hotStreak[0].minStreak);
const sn = gear.safetyNet;
check('Safety Net premium is more than half the cover (loses money unless you lose >57% of the time)', sn.premiumFraction / sn.coverFraction > 0.5, `${sn.premiumFraction}/${sn.coverFraction}`);
// Two accounts: one loses on purpose to the other. The pair pays the rake (venueRake of the POT = 2x venueRake of one buy-in) plus the premium and gets the cover back.
check('Safety Net cannot be farmed by two accounts (2 x rake + premium > cover)', 2 * cfg.venueRake + sn.premiumFraction > sn.coverFraction, `2 x ${cfg.venueRake} + ${sn.premiumFraction} vs ${sn.coverFraction}`);
check('Safety Net cover is far below the buy-in (it softens a loss, never erases it)', sn.coverFraction <= 0.5);
console.log(`  Safety Net by venue: ${Object.entries(cfg.venues).filter(([, v]) => v.buyIn > 0).map(([id, v]) => `${id} ${Math.round(v.buyIn * sn.premiumFraction)} -> back ${Math.round(v.buyIn * sn.coverFraction)}`).join(', ')}`);

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

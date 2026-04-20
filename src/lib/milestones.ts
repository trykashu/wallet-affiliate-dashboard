/**
 * Milestone definitions for referred user counts, earnings, and volume thresholds.
 * Used to send celebration notifications when affiliates cross key thresholds.
 */

export const USER_MILESTONES = [
  { count: 1,    title: "First referred user!",                body: "You're on the board! Your first referral has signed up." },
  { count: 10,   title: "10 referred users!",                  body: "Double digits! 10 referred users and counting." },
  { count: 25,   title: "25 referred users!",                  body: "Impressive growth — 25 referred users puts you in elite company." },
  { count: 50,   title: "50 referred users!",                  body: "Half a century of users! You're one of our top performers." },
  { count: 100,  title: "100 referred users!",                 body: "Triple digits! 100 referred users — you're a Kashu legend." },
  { count: 250,  title: "250 referred users!",                 body: "A quarter thousand! Your network is truly massive." },
  { count: 500,  title: "500 referred users!",                 body: "500 users referred — you're in a league of your own." },
];

export const EARNINGS_MILESTONES = [
  { amount: 50,     title: "First $50 earned!",                body: "Your first fifty dollars in commissions — here's to many more." },
  { amount: 250,    title: "$250 in earnings!",                body: "You've crossed $250 in total earnings. Keep it up!" },
  { amount: 1000,   title: "$1,000 milestone!",                body: "Four figures! $1,000 in earnings is a serious achievement." },
  { amount: 5000,   title: "$5,000 — serious earner!",         body: "You've earned $5,000 in commissions. You're in the top tier." },
  { amount: 10000,  title: "$10,000 — top performer!",         body: "$10,000 earned — you're one of our highest-earning affiliates." },
  { amount: 50000,  title: "$50,000 — legendary earner!",      body: "$50,000 in total earnings — an extraordinary achievement." },
];

export const VOLUME_MILESTONES = [
  { amount: 100_000, title: "Platinum upgrade — $100K volume!", body: "Your referred users have generated $100K in lifetime volume. Welcome to Platinum!" },
];

/**
 * Check if a referred user count crosses any milestone threshold.
 * Returns the milestone if crossed, null otherwise.
 */
export function checkUserMilestone(referredUserCount: number) {
  // Return the exact milestone that matches (not "closest")
  return USER_MILESTONES.find((m) => m.count === referredUserCount) ?? null;
}

/**
 * Check if a total earnings amount crosses any milestone threshold.
 * Returns the highest milestone crossed that wasn't previously crossed.
 */
export function checkEarningsMilestone(totalEarnings: number, previousTotal: number) {
  return EARNINGS_MILESTONES.find(
    (m) => totalEarnings >= m.amount && previousTotal < m.amount
  ) ?? null;
}

/**
 * Check if referred volume crosses the Platinum upgrade threshold.
 * Returns the milestone if crossed, null otherwise.
 */
export function checkVolumeMilestone(totalVolume: number, previousVolume: number) {
  return VOLUME_MILESTONES.find(
    (m) => totalVolume >= m.amount && previousVolume < m.amount
  ) ?? null;
}

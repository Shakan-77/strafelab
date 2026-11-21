/**
 * One shared model for enemy return fire, used by every drill where bots shoot back
 * (Peek Duels, Angle Hold, Movement Course). A bot reacts after `reaction` seconds once it can
 * see you, then fires rifle taps every `interval` seconds. Each tap hits with a chance that
 * depends on how you're moving (above the accuracy deadzone counts as moving, like Valorant's
 * movement error), and a hit is a headshot with chance `head`. Hits use rifle damage against
 * your 150 HP (100 health + 50 shields), so one body hit doesn't kill you.
 */
export const BOT_SKILL = {
  easy: { reaction: 0.5, interval: 0.16, hitStill: 0.7, hitMoving: 0.3, hitAir: 0.15, head: 0.25 },
  medium: { reaction: 0.38, interval: 0.13, hitStill: 0.8, hitMoving: 0.4, hitAir: 0.2, head: 0.35 },
  hard: { reaction: 0.28, interval: 0.11, hitStill: 0.88, hitMoving: 0.5, hitAir: 0.25, head: 0.45 },
};

export const PLAYER_HP = 150;
const DMG = { head: 160, body: 40 };

export class BotGun {
  constructor(game, rng, difficulty) {
    this.game = game;
    this.rng = rng;
    this.skill = BOT_SKILL[difficulty] || BOT_SKILL.medium;
  }

  get reaction() {
    return this.skill.reaction;
  }

  get interval() {
    return this.skill.interval;
  }

  /** How the bot sees your movement right now. */
  targetState() {
    const p = this.game.player;
    if (!p.onGround) return 'air';
    return p.hspeed() > p.accurateSpeed ? 'moving' : 'still';
  }

  /** Fire one tap from `from` (bot head). Returns { hit, zone, damage, state }. */
  shoot(from) {
    const sk = this.skill;
    const state = this.targetState();
    const chance = state === 'air' ? sk.hitAir : state === 'moving' ? sk.hitMoving : sk.hitStill;
    this.game.enemyTracer(from);
    if (!this.rng.chance(chance)) return { hit: false, state };
    const zone = this.rng.chance(sk.head) ? 'head' : 'body';
    return { hit: true, zone, damage: DMG[zone], state };
  }
}

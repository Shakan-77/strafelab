/**
 * One shared model for enemy return fire, used by every drill where bots shoot back
 * (Peek Duels, Angle Hold, Movement Course). A bot reacts after `reaction` seconds once it can
 * see you, then fires rifle taps every `interval` seconds. Each tap hits with a chance that
 * depends on how you're moving (above the accuracy deadzone counts as moving, like Valorant's
 * movement error), and a hit is a headshot with chance `head`. Hits use rifle damage against
 * your 150 HP (100 health + 50 shields), so one body hit doesn't kill you.
 */
export const BOT_SKILL = {
  easy: { reaction: 0.45, interval: 0.15, hitStill: 0.75, hitMoving: 0.35, hitAir: 0.18, head: 0.3 },
  medium: { reaction: 0.34, interval: 0.12, hitStill: 0.85, hitMoving: 0.45, hitAir: 0.23, head: 0.4 },
  hard: { reaction: 0.25, interval: 0.105, hitStill: 0.92, hitMoving: 0.55, hitAir: 0.28, head: 0.5 },
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
    this.game.player.tag(); // you get tagged (slowed) when hit, like Valorant
    const zone = this.rng.chance(sk.head) ? 'head' : 'body';
    return { hit: true, zone, damage: DMG[zone], state };
  }
}

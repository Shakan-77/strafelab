/** Seeded RNG (mulberry32). Party members share a seed so everyone gets the same spawns. */
export class RNG {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.a = this.seed || 0x9e3779b9;
  }
  next() {
    let t = (this.a = (this.a + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  float(a = 0, b = 1) {
    if (Array.isArray(a)) [a, b] = a;
    return a + (b - a) * this.next();
  }
  int(a, b) {
    return Math.floor(this.float(a, b + 1));
  }
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }
  chance(p) {
    return this.next() < p;
  }
  sign() {
    return this.next() < 0.5 ? -1 : 1;
  }
  /** Independent child stream, so per-bot decisions don't shift the main sequence. */
  fork() {
    return new RNG((this.next() * 4294967296) >>> 0);
  }
}

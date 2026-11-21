/** WebSocket client with auto-reconnect and a tiny pub/sub. */
export class Net {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.status = 'offline';
    this.id = null;
    this.hello = null;
    this.retry = 1000;
    this.latency = null;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
  }

  emit(type, msg) {
    for (const fn of this.handlers.get(type) || []) {
      try {
        fn(msg);
      } catch (e) {
        console.error(`[net] handler for ${type} failed`, e);
      }
    }
  }

  setStatus(s) {
    this.status = s;
    this.emit('status', s);
  }

  connect(hello) {
    this.hello = hello;
    if (location.protocol === 'file:') {
      this.setStatus('offline');
      return;
    }
    this.open();
    setInterval(() => this.send({ t: 'ping', ts: performance.now() }), 5000);
    this.on('pong', (m) => {
      if (typeof m.ts === 'number') this.latency = Math.round(performance.now() - m.ts);
      this.emit('latency', this.latency);
    });
  }

  open() {
    this.setStatus('connecting');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let ws;
    try {
      ws = new WebSocket(`${proto}://${location.host}/ws`);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 1000;
      ws.send(JSON.stringify(this.hello()));
    };
    ws.onmessage = (e) => {
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m.t === 'welcome') {
        this.id = m.id;
        this.setStatus('online');
      }
      this.emit(m.t, m);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.id = null;
      this.setStatus('offline');
      this.emit('party', { party: null, disconnected: true });
      this.scheduleReconnect();
    };
    ws.onerror = () => {};
  }

  scheduleReconnect() {
    setTimeout(() => this.open(), this.retry);
    this.retry = Math.min(this.retry * 2, 10000);
  }

  get online() {
    return this.status === 'online' && this.ws && this.ws.readyState === 1;
  }

  send(obj) {
    if (!this.online) return false;
    this.ws.send(JSON.stringify(obj));
    return true;
  }
}

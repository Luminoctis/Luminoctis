// Эквалайзер Luminoctis Home: актор в вкладках сайтов. Регистрирует home/equalizer.js (ChromeUtils.registerWindowActor "LumiEq").
// Home спрашивает спектр (sendQuery "spectrum") ~30 раз в секунду, только пока видна и только у вкладок со звуком (soundplaying).
// Ребёнок подключает <video>/<audio> страницы: element → MediaElementSource → Gain (громкость/muted элемента) → destination (звук как раньше)
//                                                                                          └→ ChannelSplitter → 2 AnalyserNode (L, R).
// Подключаем только если AudioContext реально запущен (иначе политика автозапуска заглушила бы звук) и медиа своего источника
// (чужой источник без CORS дал бы тишину и в динамиках) — остальное тихо пропускаем.
export class LumiEqParent extends JSWindowActorParent {}

const BINS = 64;
export class LumiEqChild extends JSWindowActorChild {
  receiveMessage(msg) {
    if (msg.name == "spectrum") return this.spectrum();
    if (msg.name == "state") return { ctx: this.ctx?.state ?? null, connected: this.els?.length ?? 0, err: this.err ?? null, // для проверок
      media: [...this.document.querySelectorAll("video, audio")].map(e => ({ paused: e.paused, own: this.ownSource(e), src: e.currentSrc.slice(0, 40) })) };
    return null;
  }
  spectrum() {
    if (Date.now() - (this.scanned ?? 0) > 1000) { this.scanned = Date.now(); this.scan().catch(e => (this.err = String(e))); }
    if (!this.an || !this.els?.some(e => !e.paused)) return null;
    const b = new Uint8Array(BINS), out = [];
    for (const an of this.an) { an.getByteFrequencyData(b); for (const v of b) out.push(v / 255); }
    return out;
  }
  ownSource(el) {
    if (el.srcObject) return false;
    if (el.crossOrigin != null) return true; // CORS-запрос: если сервер не разрешил, медиа не загрузится вовсе
    const src = el.currentSrc;
    if (!src || /^(blob|data):/.test(src)) return true;
    try { return new URL(src).origin == this.contentWindow.origin; } catch { return false; }
  }
  async scan() {
    const win = this.contentWindow;
    if (!win || this.scanning) return;
    this.scanning = true;
    try {
      this.done ??= new WeakSet();
      for (const el of this.document.querySelectorAll("video, audio")) {
        if (this.done.has(el) || el.paused || !this.ownSource(el)) continue;
        if (!(await this.context())) return;
        try {
          const src = this.ctx.createMediaElementSource(el); // элемент уже подключён самой страницей — исключение, пропускаем
          // после подключения Gecko уже не применяет громкость элемента сам — повторяем её усилителем (ползунок громкости сайта работает)
          const gain = this.ctx.createGain(), sync = () => (gain.gain.value = el.muted ? 0 : el.volume);
          sync();
          el.addEventListener("volumechange", sync);
          src.connect(gain);
          gain.connect(this.ctx.destination);
          gain.connect(this.mix);
          (this.els ??= []).push(el);
        } catch (e) { this.err = String(e); }
        this.done.add(el);
      }
      this.els = this.els?.filter(e => e.isConnected);
    } finally { this.scanning = false; }
  }
  // AudioContext страницы; не запустился за 0.5 с (автозапуск запрещён) — закрываем и пробуем при следующем просмотре
  async context() {
    if (this.ctx) return true;
    const ctx = new this.contentWindow.AudioContext();
    if (ctx.state != "running") {
      ctx.resume().catch(() => {});
      await new Promise(r => { const t = this.contentWindow.setTimeout(r, 500); ctx.onstatechange = () => ctx.state == "running" && (this.contentWindow.clearTimeout(t), r()); });
    }
    if (ctx.state != "running") { ctx.close().catch(() => {}); this.scanned = Date.now() + 4000; return false; } // следующая попытка через 5 с
    this.split = ctx.createChannelSplitter(2);
    this.mix = new this.contentWindow.GainNode(ctx, { channelCount: 2, channelCountMode: "explicit", channelInterpretation: "speakers" }); // моно — в оба канала
    this.mix.connect(this.split);
    this.an = [0, 1].map(ch => {
      const an = ctx.createAnalyser();
      an.fftSize = BINS * 2;
      an.smoothingTimeConstant = 0.5;
      this.split.connect(an, ch);
      return an;
    });
    this.ctx = ctx;
    return true;
  }
}

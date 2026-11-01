// Громкость медиа на странице (<video>/<audio>): миниплеер на рейке (js/lumi-rail.uc.js) спрашивает и меняет её через этот актор.
// Работает в каждом фрейме страницы (allFrames), в том числе во встроенных плеерах (YouTube embed).
export class LumiMediaChild extends JSWindowActorChild {
  receiveMessage({ name, data }) {
    const media = [...(this.document?.querySelectorAll("video, audio") ?? [])];
    if (name == "get") {
      const m = media.find(m => !m.paused) ?? media[0];
      return m ? { volume: m.muted ? 0 : m.volume, playing: !m.paused } : null;
    }
    if (name == "set") {
      for (const m of media) {
        m.volume = data;
        m.muted = data == 0;
      }
      return media.length;
    }
    return null;
  }
}

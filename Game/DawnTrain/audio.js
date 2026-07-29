"use strict";

(function (DT) {
  class DawnAudio {
    constructor() {
      this.muted = false;
      this.bgmVolume = 0.4;
      this.sfxVolume = 0.7;
      this.chapter = 1;
      this.scene = "title";
      this.playingScene = null;
      this.bgm = null;
      this.fadeTimer = null;
      this.unlocked = false;
      this.transitionId = 0;
      this.sfxCache = new Map();
      this.activeSfx = new Set();
      this.bgmFiles = {
        title: "assets/audio/bgm/title.ogg?v=2.1.1",
        journey: "assets/audio/bgm/journey.ogg?v=2.1.1",
        battle: "assets/audio/bgm/battle.ogg?v=2.1.1",
        boss: "assets/audio/bgm/boss.ogg?v=2.1.1",
        ending: "assets/audio/bgm/ending.ogg?v=2.1.1"
      };
      this.sfxFiles = Object.fromEntries([
        "confirm", "lever", "cancel", "paper", "story", "move",
        "attack", "hit", "repair", "steam", "victory", "defeat"
      ].map(name => [name, `assets/audio/sfx/${name}.ogg?v=2.1.1`]));

      const unlock = () => {
        this.unlocked = true;
        document.removeEventListener("pointerdown", unlock, true);
        document.removeEventListener("keydown", unlock, true);
        this.preloadEffects();
        this.startBgm();
      };
      document.addEventListener("pointerdown", unlock, true);
      document.addEventListener("keydown", unlock, true);
    }

    ensure() {
      this.unlocked = true;
      this.preloadEffects();
      this.startBgm();
      return typeof Audio !== "undefined";
    }

    configure(settings) {
      this.muted = settings.sound === false;
      this.bgmVolume = Math.max(0, Math.min(1, Number(settings.bgmVolume ?? 0.4)));
      this.sfxVolume = Math.max(0, Math.min(1, Number(settings.sfxVolume ?? settings.volume ?? 0.7)));
      if (this.muted) {
        this.stopBgm();
        this.activeSfx.forEach(sample => { try { sample.pause(); } catch (_) {} });
        this.activeSfx.clear();
      } else {
        if (this.bgm) this.bgm.volume = this.bgmVolume;
        this.startBgm();
      }
    }

    setChapter(chapter) {
      this.chapter = Math.max(1, Math.min(7, Number(chapter) || 1));
    }

    setScene(scene) {
      if (!this.bgmFiles[scene]) return;
      this.scene = scene;
      this.startBgm();
    }

    preloadEffects() {
      if (typeof Audio === "undefined" || this.sfxCache.size) return;
      Object.entries(this.sfxFiles).forEach(([name, src]) => {
        const sample = new Audio(src);
        sample.preload = "auto";
        this.sfxCache.set(name, sample);
      });
    }

    startBgm() {
      if (this.muted || !this.unlocked || typeof Audio === "undefined") return;
      if (this.bgm && this.playingScene === this.scene) {
        this.bgm.volume = this.bgmVolume;
        if (this.bgm.paused) this.bgm.play().catch(() => {});
        return;
      }

      const id = ++this.transitionId;
      const next = new Audio(this.bgmFiles[this.scene]);
      next.loop = true;
      next.preload = "auto";
      next.volume = 0;
      const requestedScene = this.scene;
      next.play().then(() => {
        if (id !== this.transitionId || this.muted || requestedScene !== this.scene) {
          next.pause();
          return;
        }
        this.crossfadeTo(next, requestedScene);
      }).catch(() => {});
    }

    crossfadeTo(next, scene) {
      window.clearInterval(this.fadeTimer);
      const previous = this.bgm;
      this.bgm = next;
      this.playingScene = scene;
      const started = performance.now();
      const duration = previous ? 1_150 : 520;
      this.fadeTimer = window.setInterval(() => {
        const progress = Math.min(1, (performance.now() - started) / duration);
        next.volume = this.bgmVolume * progress;
        if (previous) previous.volume = this.bgmVolume * (1 - progress);
        if (progress >= 1) {
          window.clearInterval(this.fadeTimer);
          this.fadeTimer = null;
          if (previous) { previous.pause(); previous.removeAttribute("src"); }
        }
      }, 40);
    }

    stopBgm() {
      this.transitionId += 1;
      window.clearInterval(this.fadeTimer);
      this.fadeTimer = null;
      if (this.bgm) {
        this.bgm.pause();
        this.bgm.removeAttribute("src");
      }
      this.bgm = null;
      this.playingScene = null;
    }

    play(name) {
      if (this.muted || typeof Audio === "undefined") return;
      this.ensure();
      const source = this.sfxCache.get(name) || this.sfxCache.get("confirm");
      if (!source) return;
      const sample = source.cloneNode(true);
      sample.volume = this.sfxVolume;
      this.activeSfx.add(sample);
      const release = () => this.activeSfx.delete(sample);
      sample.addEventListener("ended", release, { once: true });
      sample.addEventListener("error", release, { once: true });
      sample.play().catch(release);
    }

    // 2.0以前の呼び出し名を維持する。BGMの場面管理はsetSceneが担当する。
    startRail() {
      this.ensure();
    }

    stopRail() {}
  }

  DT.audio = new DawnAudio();
})(window.DT);

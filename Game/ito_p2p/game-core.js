(function initItoGameCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ItoGameCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createItoGameCore() {
  "use strict";

  const MAX_PLAYERS = 12;

  function cleanName(value, fallback = "プレイヤー") {
    const normalized = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 16);
    return normalized || fallback;
  }

  function shuffle(values, random = Math.random) {
    const result = values.slice();
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  class ItoGame {
    constructor({ hostId = "host", topics = [], random = Math.random } = {}) {
      this.hostId = hostId;
      this.topics = Array.isArray(topics) && topics.length > 0
        ? topics.slice()
        : ["好きな食べ物の人気（1:人気がない-100:人気がある）"];
      this.random = random;
      this.players = [];
      this.phase = "lobby";
      this.round = 0;
      this.topic = "";
      this.roundPlayerIds = [];
      this.cards = new Map();
      this.confirmed = new Set();
      this.revealed = [];
      this.result = null;
      this.notice = "";
    }

    addPlayer({ id, name, role = "player", isHost = false }) {
      if (!id) throw new Error("プレイヤーIDが必要です。");
      const existing = this.getPlayer(id);
      if (existing) {
        existing.connected = true;
        existing.name = cleanName(name, existing.name);
        return existing;
      }

      let acceptedRole = role === "spectator" ? "spectator" : "player";
      if (this.phase !== "lobby" && acceptedRole === "player") acceptedRole = "spectator";
      if (acceptedRole === "player" && this.playerMembers().length >= MAX_PLAYERS) {
        acceptedRole = "spectator";
      }

      const player = {
        id,
        name: cleanName(name, isHost ? "ホスト" : "プレイヤー"),
        role: acceptedRole,
        slot: null,
        connected: true,
        isHost: Boolean(isHost),
      };
      this.players.push(player);
      this.normalizeSlots();
      return player;
    }

    getPlayer(id) {
      return this.players.find((player) => player.id === id) || null;
    }

    playerMembers() {
      return this.players.filter((player) => player.role === "player");
    }

    connectedPlayerMembers() {
      return this.playerMembers().filter((player) => player.connected);
    }

    normalizeSlots() {
      let slot = 1;
      for (const player of this.players) {
        if (player.role === "player") {
          player.slot = slot;
          slot += 1;
        } else {
          player.slot = null;
        }
      }
    }

    removePlayer(id) {
      if (id === this.hostId) return false;
      const index = this.players.findIndex((player) => player.id === id);
      if (index < 0) return false;
      this.players.splice(index, 1);
      this.excludeFromRound(id);
      if (this.phase === "lobby") this.normalizeSlots();
      return true;
    }

    setConnected(id, connected) {
      const player = this.getPlayer(id);
      if (!player) return false;
      player.connected = Boolean(connected);
      if (!player.connected && this.phase !== "lobby") {
        this.excludeFromRound(id);
        this.notice = `${player.name}さんが切断されたため、今回の参加者から外しました。`;
      }
      return true;
    }

    excludeFromRound(id) {
      const oldLength = this.roundPlayerIds.length;
      this.roundPlayerIds = this.roundPlayerIds.filter((playerId) => playerId !== id);
      this.cards.delete(id);
      this.confirmed.delete(id);
      this.revealed = this.revealed.filter((entry) => entry.id !== id);

      if (this.roundPlayerIds.length === oldLength) return;
      if (this.phase === "confirm" && this.confirmed.size >= this.roundPlayerIds.length) {
        this.phase = "discussion";
      }
      if (this.phase === "discussion" && this.revealed.length >= this.roundPlayerIds.length) {
        this.finishRound();
      }
    }

    action(actorId, type) {
      const actor = this.getPlayer(actorId);
      if (!actor || !actor.connected) return { ok: false, reason: "参加者が見つかりません。" };

      switch (type) {
        case "START":
          if (actorId !== this.hostId) return { ok: false, reason: "開始できるのはホストだけです。" };
          return this.startRound();
        case "CONFIRM":
          return this.confirmNumber(actorId);
        case "REVEAL":
          return this.revealCard(actorId);
        case "RESTART":
          if (actorId !== this.hostId) return { ok: false, reason: "再開できるのはホストだけです。" };
          if (this.phase !== "result") return { ok: false, reason: "まだゲームが終了していません。" };
          return this.startRound();
        case "BACK_TO_LOBBY":
          if (actorId !== this.hostId) return { ok: false, reason: "ロビーへ戻せるのはホストだけです。" };
          return this.backToLobby();
        default:
          return { ok: false, reason: "不明な操作です。" };
      }
    }

    startRound() {
      const participants = this.connectedPlayerMembers();
      if (participants.length < 2) {
        return { ok: false, reason: "2人以上のプレイヤーが必要です。" };
      }
      if (participants.length > 100) {
        return { ok: false, reason: "プレイヤー数が多すぎます。" };
      }

      this.round += 1;
      this.phase = "confirm";
      this.topic = this.topics[Math.floor(this.random() * this.topics.length)];
      this.roundPlayerIds = participants.map((player) => player.id);
      this.cards = new Map();
      this.confirmed = new Set();
      this.revealed = [];
      this.result = null;
      this.notice = "";

      const deck = shuffle(Array.from({ length: 100 }, (_, index) => index + 1), this.random);
      this.roundPlayerIds.forEach((id, index) => this.cards.set(id, deck[index]));
      return { ok: true };
    }

    confirmNumber(actorId) {
      if (this.phase !== "confirm") return { ok: false, reason: "今は番号確認の時間ではありません。" };
      if (!this.roundPlayerIds.includes(actorId)) return { ok: false, reason: "今回は観戦参加です。" };
      this.confirmed.add(actorId);
      if (this.confirmed.size >= this.roundPlayerIds.length) this.phase = "discussion";
      return { ok: true };
    }

    revealCard(actorId) {
      if (this.phase !== "discussion") return { ok: false, reason: "今はカードを公開できません。" };
      if (!this.roundPlayerIds.includes(actorId)) return { ok: false, reason: "今回は観戦参加です。" };
      if (this.revealed.some((entry) => entry.id === actorId)) return { ok: true };

      const player = this.getPlayer(actorId);
      this.revealed.push({
        id: actorId,
        slot: player ? player.slot : null,
        name: player ? player.name : "プレイヤー",
        card: this.cards.get(actorId),
      });
      if (this.revealed.length >= this.roundPlayerIds.length) this.finishRound();
      return { ok: true };
    }

    finishRound() {
      const sortedCards = this.revealed.map((entry) => entry.card).slice().sort((a, b) => a - b);
      const cards = this.revealed.map((entry, index) => ({
        ...entry,
        wrong: entry.card !== sortedCards[index],
      }));
      this.result = {
        success: cards.every((entry) => !entry.wrong),
        cards,
      };
      this.phase = "result";
    }

    backToLobby() {
      this.players = this.players.filter((player) => player.connected || player.id === this.hostId);
      this.normalizeSlots();
      this.phase = "lobby";
      this.topic = "";
      this.roundPlayerIds = [];
      this.cards = new Map();
      this.confirmed = new Set();
      this.revealed = [];
      this.result = null;
      this.notice = "";
      return { ok: true };
    }

    stateFor(viewerId) {
      const viewer = this.getPlayer(viewerId);
      const selfCard = this.cards.has(viewerId) ? this.cards.get(viewerId) : null;
      return {
        phase: this.phase,
        round: this.round,
        topic: this.phase === "discussion" || this.phase === "result" ? this.topic : "",
        players: this.players.map((player) => ({ ...player })),
        roundPlayerIds: this.roundPlayerIds.slice(),
        confirmedCount: this.confirmed.size,
        revealed: this.revealed.map((entry) => ({ ...entry })),
        result: this.result
          ? { success: this.result.success, cards: this.result.cards.map((entry) => ({ ...entry })) }
          : null,
        self: viewer ? { ...viewer } : null,
        selfCard,
        selfConfirmed: this.confirmed.has(viewerId),
        selfRevealed: this.revealed.some((entry) => entry.id === viewerId),
        isHost: viewerId === this.hostId,
        notice: this.notice,
      };
    }
  }

  return { ItoGame, cleanName, shuffle, MAX_PLAYERS };
});

(function runItoP2P() {
  "use strict";

  const HOST_ID = "host";
  const SIGNAL_PREFIX = "ITOP2P1";
  // Base45をQRのAlphanumericモード（1文字5.5bit）で運ぶため、Base64+Byteモード（1文字8bit）だった
  // 旧実装の720文字より大きい枠を1枚のQRに収められる。同程度の見た目の密度になるよう逆算した値。
  const QR_CHUNK_SIZE = 1024;
  const STUN_URL = "stun:stun.cloudflare.com:3478";
  const ICE_GATHER_TIMEOUT_WITH_STUN = 30000;
  const ICE_GATHER_TIMEOUT_LOCAL = 10000;
  const CONNECTION_TIMEOUT = 35000;
  const FALLBACK_TOPICS = [
    "食べ物の人気（1:人気がない-100:人気がある）",
    "旅行先として行きたい場所（1:行きたくない-100:行きたい）",
    "もらって嬉しいプレゼント（1:嬉しくない-100:嬉しい）",
    "強そうな動物（1:弱そう-100:強そう）",
    "休日にやりたいこと（1:やりたくない-100:やりたい）",
  ];

  const byId = (id) => document.getElementById(id);
  const elements = {
    setupScreen: byId("setupScreen"),
    sessionScreen: byId("sessionScreen"),
    hostName: byId("hostName"),
    guestName: byId("guestName"),
    guestRole: byId("guestRole"),
    useStun: byId("useStun"),
    createRoomBtn: byId("createRoomBtn"),
    joinRoomBtn: byId("joinRoomBtn"),
    guestConnectStatus: byId("guestConnectStatus"),
    guestPanelHint: byId("guestPanelHint"),
    connectionDot: byId("connectionDot"),
    connectionLabel: byId("connectionLabel"),
    networkModeBadge: byId("networkModeBadge"),
    addPeerBtn: byId("addPeerBtn"),
    scanAnswerBtn: byId("scanAnswerBtn"),
    leaveSessionBtn: byId("leaveSessionBtn"),
    notice: byId("notice"),
    lobbyView: byId("lobbyView"),
    confirmView: byId("confirmView"),
    discussionView: byId("discussionView"),
    resultView: byId("resultView"),
    playerCountBadge: byId("playerCountBadge"),
    playerList: byId("playerList"),
    spectatorList: byId("spectatorList"),
    lobbyActionTitle: byId("lobbyActionTitle"),
    lobbyActionText: byId("lobbyActionText"),
    startGameBtn: byId("startGameBtn"),
    confirmProgress: byId("confirmProgress"),
    privateCard: byId("privateCard"),
    privateCardSlot: byId("privateCardSlot"),
    privateCardNumber: byId("privateCardNumber"),
    confirmInstruction: byId("confirmInstruction"),
    confirmNumberBtn: byId("confirmNumberBtn"),
    confirmWaitingText: byId("confirmWaitingText"),
    revealProgress: byId("revealProgress"),
    topicText: byId("topicText"),
    revealedCards: byId("revealedCards"),
    handPanel: byId("handPanel"),
    handCard: byId("handCard"),
    handCardSlot: byId("handCardSlot"),
    handCardNumber: byId("handCardNumber"),
    handTitle: byId("handTitle"),
    handDescription: byId("handDescription"),
    revealCardBtn: byId("revealCardBtn"),
    resultHero: byId("resultHero"),
    resultTitle: byId("resultTitle"),
    resultSubtitle: byId("resultSubtitle"),
    resultCards: byId("resultCards"),
    resultWaiting: byId("resultWaiting"),
    restartGameBtn: byId("restartGameBtn"),
    backToLobbyBtn: byId("backToLobbyBtn"),
    signalDialog: byId("signalDialog"),
    dialogTitle: byId("dialogTitle"),
    closeDialogBtn: byId("closeDialogBtn"),
    signalPreparing: byId("signalPreparing"),
    preparingText: byId("preparingText"),
    signalDisplay: byId("signalDisplay"),
    displayInstruction: byId("displayInstruction"),
    qrDisplay: byId("qrDisplay"),
    qrPager: byId("qrPager"),
    prevQrBtn: byId("prevQrBtn"),
    nextQrBtn: byId("nextQrBtn"),
    qrPageLabel: byId("qrPageLabel"),
    copySignalBtn: byId("copySignalBtn"),
    displayNextActionBtn: byId("displayNextActionBtn"),
    outgoingSignalText: byId("outgoingSignalText"),
    shareLinkBlock: byId("shareLinkBlock"),
    shareLinkInput: byId("shareLinkInput"),
    shareLinkCopyBtn: byId("shareLinkCopyBtn"),
    shareLinkBtn: byId("shareLinkBtn"),
    signalScanner: byId("signalScanner"),
    scannerInstruction: byId("scannerInstruction"),
    scannerVideo: byId("scannerVideo"),
    scannerCanvas: byId("scannerCanvas"),
    scanProgress: byId("scanProgress"),
    incomingSignalText: byId("incomingSignalText"),
    applySignalBtn: byId("applySignalBtn"),
    signalError: byId("signalError"),
    signalErrorTitle: byId("signalErrorTitle"),
    signalErrorText: byId("signalErrorText"),
    retryScanBtn: byId("retryScanBtn"),
    diagnosticDetails: byId("diagnosticDetails"),
    diagnosticHeadline: byId("diagnosticHeadline"),
    diagnosticHint: byId("diagnosticHint"),
    diagnosticText: byId("diagnosticText"),
    copyDiagnosticBtn: byId("copyDiagnosticBtn"),
  };

  let mode = "setup";
  let selfId = null;
  let game = null;
  let currentState = null;
  let topicsPromise = null;
  let sessionId = null;
  let useStunForSession = false;
  let pendingHostPeer = null;
  let guestPeer = null;
  let guestProfile = null;
  let wakeLock = null;
  let pendingUrlOffer = null;
  const hostPeers = new Map();

  let currentQrChunks = [];
  let currentQrIndex = 0;
  let currentSignalCode = "";
  let scannerStream = null;
  let scannerFrame = 0;
  let scannerBusy = false;
  let expectedSignalKind = null;
  let scannedChunkSet = new Set();
  let chunkAccumulator = null;
  let activeDiagnosticPeer = null;

  function createId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function setPane(activePane) {
    [elements.signalPreparing, elements.signalDisplay, elements.signalScanner, elements.signalError]
      .forEach((pane) => pane.classList.toggle("hidden", pane !== activePane));
  }

  function openDialog() {
    if (!elements.signalDialog.open) elements.signalDialog.showModal();
  }

  function closeDialog() {
    stopCamera();
    if (elements.signalDialog.open) elements.signalDialog.close();
  }

  function showPreparing(title, text) {
    openDialog();
    stopCamera();
    elements.dialogTitle.textContent = title;
    elements.preparingText.textContent = text;
    setPane(elements.signalPreparing);
  }

  function showSignalError(error, allowRetry = true, title = "接続情報を処理できませんでした") {
    stopCamera();
    elements.signalErrorTitle.textContent = title;
    elements.signalErrorText.textContent = error instanceof Error ? error.message : String(error);
    elements.retryScanBtn.classList.toggle("hidden", !allowRetry);
    setPane(elements.signalError);
  }

  function showNotice(text) {
    elements.notice.textContent = text || "";
    elements.notice.classList.toggle("hidden", !text);
  }

  function setConnectionStatus(label, state = "online") {
    elements.connectionLabel.textContent = label;
    elements.connectionDot.className = `status-dot ${state}`;
  }

  async function loadTopics() {
    if (!topicsPromise) {
      topicsPromise = fetch("topics.json", { cache: "force-cache" })
        .then((response) => {
          if (!response.ok) throw new Error(`お題の取得に失敗しました (${response.status})`);
          return response.json();
        })
        .then((topics) => Array.isArray(topics) && topics.length ? topics : FALLBACK_TOPICS)
        .catch(() => FALLBACK_TOPICS);
    }
    return topicsPromise;
  }

  function peerConfiguration(useStun) {
    return {
      iceServers: useStun ? [{ urls: STUN_URL }] : [],
      bundlePolicy: "max-bundle",
    };
  }

  function createPeerConnection(useStun) {
    if (!("RTCPeerConnection" in window)) {
      throw new Error("このブラウザはWebRTC接続に対応していません。");
    }
    return new RTCPeerConnection(peerConfiguration(useStun));
  }

  function emptyCandidateCounts() {
    return { host: 0, srflx: 0, prflx: 0, relay: 0, unknown: 0 };
  }

  function candidateType(candidate) {
    if (!candidate) return "unknown";
    if (candidate.type) return candidate.type;
    const match = String(candidate.candidate || candidate).match(/\styp\s(host|srflx|prflx|relay)(?:\s|$)/);
    return match ? match[1] : "unknown";
  }

  function candidateCountsFromSdp(sdp) {
    const counts = emptyCandidateCounts();
    for (const match of String(sdp || "").matchAll(/^a=candidate:[^\r\n]*\styp\s(host|srflx|prflx|relay)(?:\s|$)/gm)) {
      counts[match[1]] += 1;
    }
    return counts;
  }

  function candidateCountsFromKeys(keys) {
    const counts = emptyCandidateCounts();
    for (const key of keys || []) counts[candidateType(key)] += 1;
    return counts;
  }

  function countCandidates(counts) {
    return Object.values(counts).reduce((sum, count) => sum + count, 0);
  }

  function formatCandidateCounts(counts) {
    return `host=${counts.host}, srflx=${counts.srflx}, prflx=${counts.prflx}, relay=${counts.relay}`;
  }

  function localCandidateCounts(peer) {
    const fromSdp = candidateCountsFromSdp(peer.pc.localDescription?.sdp);
    return countCandidates(fromSdp) > 0 ? fromSdp : candidateCountsFromKeys(peer.debug?.localCandidateKeys);
  }

  function remoteCandidateCounts(peer) {
    const fromSdp = candidateCountsFromSdp(peer.pc.remoteDescription?.sdp);
    if (countCandidates(fromSdp) > 0) return fromSdp;
    return peer.debug?.remoteSignal?.candidateTypes || emptyCandidateCounts();
  }

  function diagnosticAssessment(peer) {
    const debug = peer.debug;
    const pc = peer.pc;
    const local = localCandidateCounts(peer);
    const remote = remoteCandidateCounts(peer);
    const remoteKnown = Boolean(pc.remoteDescription || debug.remoteSignal);
    const unreachableStun = debug.iceErrors.some((error) => error.code === 701);
    const failed = pc.connectionState === "failed"
      || pc.iceConnectionState === "failed"
      || debug.connectionTimedOut;

    if (peer.channel?.readyState === "open" || pc.connectionState === "connected") {
      const route = debug.selectedRoute;
      return {
        headline: route ? `接続成功：${route.localType} ↔ ${route.remoteType}` : "P2P接続成功",
        hint: route?.localType === "relay" || route?.remoteType === "relay"
          ? "TURN中継経路で接続しています。"
          : "端末同士の直接経路で接続しています。",
      };
    }
    if (debug.gatheringTimedOut) {
      return {
        headline: "ICE候補収集がタイムアウト",
        hint: "QRを作る前の候補収集が完了しませんでした。回線を変えるか、STUNをオフにして同じWi-Fiで試してください。",
      };
    }
    if (debug.useStun && unreachableStun && local.srflx === 0) {
      return {
        headline: "STUNサーバーへ到達できません",
        hint: "この端末またはネットワークからSTUNのUDP通信が遮断されています。srflx候補を取得できていません。",
      };
    }
    if (failed && debug.useStun && local.srflx > 0 && remote.srflx > 0) {
      return {
        headline: "STUN候補あり・直接接続に失敗",
        hint: "両端末とも外向きアドレスは取得できましたが、NATまたはファイアウォールが直接通信を許可しませんでした。TURN中継が必要な可能性が高いです。",
      };
    }
    if (failed && debug.useStun && local.srflx === 0) {
      return {
        headline: "この端末にsrflx候補がありません",
        hint: "STUNをオンにしましたが、この端末では公開側候補を取得できませんでした。ICEエラー欄を確認してください。",
      };
    }
    if (failed && debug.useStun && remoteKnown && remote.srflx === 0) {
      return {
        headline: "相手端末にsrflx候補がありません",
        hint: "相手側がSTUNサーバーへ到達できていないか、候補収集が完了する前の接続情報を使っています。",
      };
    }
    if (failed) {
      return {
        headline: "利用可能な直接経路がありません",
        hint: debug.useStun
          ? "STUNだけでは通過できないネットワーク構成です。TURN中継が必要です。"
          : "異なるネットワークではhost候補同士が到達できないため、これは想定される失敗です。",
      };
    }
    if (debug.useStun && local.srflx > 0) {
      return {
        headline: "STUN候補を取得済み・接続確認中",
        hint: "この端末のsrflx候補は取得できています。回答QR交換後、相手候補との疎通を確認します。",
      };
    }
    if (debug.useStun && pc.iceGatheringState === "complete") {
      return {
        headline: "STUN候補を取得できていません",
        hint: "候補収集は完了しましたがsrflx候補がありません。別ネットワーク間の直接接続は困難です。",
      };
    }
    return {
      headline: "ICE候補を確認中",
      hint: debug.useStun
        ? "host候補とSTUN由来のsrflx候補を収集しています。"
        : "同じローカルネットワーク内で使えるhost候補を収集しています。",
    };
  }

  function diagnosticText(peer) {
    const debug = peer.debug;
    const local = localCandidateCounts(peer);
    const remote = remoteCandidateCounts(peer);
    const elapsed = Math.round((Date.now() - debug.startedAt) / 1000);
    const errors = debug.iceErrors.length
      ? debug.iceErrors.map((error) => `  - code=${error.code} ${error.text || ""} (${error.url || "URL不明"})`).join("\n")
      : "  なし";
    const remoteErrors = debug.remoteSignal?.iceErrors?.length
      ? debug.remoteSignal.iceErrors.map((error) => `  - code=${error.code} ${error.text || ""}`).join("\n")
      : "  なし/未取得";
    const route = debug.selectedRoute
      ? `${debug.selectedRoute.localType}/${debug.selectedRoute.localProtocol} ↔ ${debug.selectedRoute.remoteType}/${debug.selectedRoute.remoteProtocol}`
      : "未選択";
    return [
      `時刻: ${new Date().toISOString()}`,
      `役割: ${debug.label}`,
      `STUN: ${debug.useStun ? `ON (${STUN_URL})` : "OFF"}`,
      `経過時間: ${elapsed}秒`,
      `signalingState: ${peer.pc.signalingState}`,
      `iceGatheringState: ${peer.pc.iceGatheringState}${debug.gatheringTimedOut ? " (timeout)" : ""}`,
      `iceConnectionState: ${peer.pc.iceConnectionState}`,
      `connectionState: ${peer.pc.connectionState}${debug.connectionTimedOut ? " (timeout)" : ""}`,
      `dataChannel: ${peer.channel?.readyState || "未作成"}`,
      `ローカル候補: ${formatCandidateCounts(local)}`,
      `相手候補: ${formatCandidateCounts(remote)}`,
      `選択経路: ${route}`,
      "この端末のICEエラー:",
      errors,
      "相手端末のICEエラー:",
      remoteErrors,
      `ブラウザ: ${navigator.userAgent}`,
    ].join("\n");
  }

  function updateDiagnosticPanel(peer = activeDiagnosticPeer) {
    if (!peer?.debug) {
      elements.diagnosticDetails.classList.add("hidden");
      return;
    }
    if (activeDiagnosticPeer && peer !== activeDiagnosticPeer) return;
    const assessment = diagnosticAssessment(peer);
    elements.diagnosticDetails.classList.remove("hidden");
    elements.diagnosticHeadline.textContent = assessment.headline;
    elements.diagnosticHint.textContent = assessment.hint;
    elements.diagnosticText.textContent = diagnosticText(peer);
  }

  function setActiveDiagnosticPeer(peer) {
    activeDiagnosticPeer = peer;
    updateDiagnosticPanel(peer);
  }

  async function inspectSelectedRoute(peer) {
    try {
      const stats = await peer.pc.getStats();
      let pair = null;
      let transport = null;
      stats.forEach((report) => {
        if (report.type === "transport" && report.selectedCandidatePairId) transport = report;
        if (report.type === "candidate-pair" && report.state === "succeeded" && (report.selected || report.nominated)) {
          pair = report;
        }
      });
      if (transport) pair = stats.get(transport.selectedCandidatePairId) || pair;
      if (!pair) return;
      const local = stats.get(pair.localCandidateId);
      const remote = stats.get(pair.remoteCandidateId);
      peer.debug.selectedRoute = {
        localType: local?.candidateType || "unknown",
        localProtocol: local?.protocol || "unknown",
        remoteType: remote?.candidateType || "unknown",
        remoteProtocol: remote?.protocol || "unknown",
      };
      updateDiagnosticPanel(peer);
    } catch (_error) {
      // 一部ブラウザで候補統計を取得できなくても接続自体には影響しない。
    }
  }

  function attachPeerDiagnostics(peer, label, useStun) {
    const debug = {
      label,
      useStun,
      startedAt: Date.now(),
      localCandidateKeys: new Set(),
      iceErrors: [],
      remoteSignal: null,
      gatheringTimedOut: false,
      connectionTimedOut: false,
      selectedRoute: null,
      failureReason: "",
    };
    peer.debug = debug;
    peer.useStun = useStun;
    const pc = peer.pc;
    pc.addEventListener("icecandidate", (event) => {
      if (event.candidate?.candidate) debug.localCandidateKeys.add(event.candidate.candidate);
      updateDiagnosticPanel(peer);
    });
    pc.addEventListener("icecandidateerror", (event) => {
      const iceError = {
        code: event.errorCode,
        text: String(event.errorText || event.statusText || "").slice(0, 180),
        url: String(event.url || "").slice(0, 180),
      };
      const duplicate = debug.iceErrors.some((error) => (
        error.code === iceError.code && error.text === iceError.text && error.url === iceError.url
      ));
      if (!duplicate && debug.iceErrors.length < 6) debug.iceErrors.push(iceError);
      updateDiagnosticPanel(peer);
    });
    ["icegatheringstatechange", "iceconnectionstatechange", "signalingstatechange", "connectionstatechange"]
      .forEach((eventName) => pc.addEventListener(eventName, () => {
        updateDiagnosticPanel(peer);
        if (pc.connectionState === "connected") void inspectSelectedRoute(peer);
      }));
    setActiveDiagnosticPeer(peer);
  }

  function exportSignalDiagnostics(peer) {
    return {
      candidateTypes: localCandidateCounts(peer),
      gatheringComplete: peer.pc.iceGatheringState === "complete",
      gatheringTimedOut: peer.debug.gatheringTimedOut,
      iceErrors: peer.debug.iceErrors.map(({ code, text, url }) => ({ code, text, url })),
    };
  }

  async function waitForIceGathering(peer) {
    const { pc } = peer;
    const timeoutMs = peer.useStun ? ICE_GATHER_TIMEOUT_WITH_STUN : ICE_GATHER_TIMEOUT_LOCAL;
    if (pc.iceGatheringState === "complete") return true;
    const completed = await new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        pc.removeEventListener("icegatheringstatechange", checkState);
        resolve(result);
      };
      const checkState = () => {
        if (pc.iceGatheringState === "complete") finish(true);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      pc.addEventListener("icegatheringstatechange", checkState);
    });
    peer.debug.gatheringTimedOut = !completed;
    updateDiagnosticPanel(peer);
    if (!completed) {
      throw new Error(`ICE候補の収集が${Math.round(timeoutMs / 1000)}秒以内に完了しませんでした。接続診断を確認してください。`);
    }
    return true;
  }

  function sendJson(channel, message) {
    if (channel && channel.readyState === "open") {
      channel.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  // RFC 9285 Base45。QRコードのAlphanumericモードの文字集合と完全に一致するため、
  // Base64+ByteモードよりもQRコード上のデータ密度を下げられる（EUのデジタル証明書QRと同じ理由）。
  const BASE45_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
  const BASE45_LOOKUP = new Map(Array.from(BASE45_CHARSET, (char, index) => [char, index]));

  function base45Encode(bytes) {
    let text = "";
    let index = 0;
    for (; index + 1 < bytes.length; index += 2) {
      const value = bytes[index] * 256 + bytes[index + 1];
      const e = Math.floor(value / 2025);
      const remainder = value % 2025;
      const d = Math.floor(remainder / 45);
      const c = remainder % 45;
      text += BASE45_CHARSET[c] + BASE45_CHARSET[d] + BASE45_CHARSET[e];
    }
    if (index < bytes.length) {
      const value = bytes[index];
      const d = Math.floor(value / 45);
      const c = value % 45;
      text += BASE45_CHARSET[c] + BASE45_CHARSET[d];
    }
    return text;
  }

  function base45Decode(text) {
    const codes = [];
    for (const character of text) {
      const value = BASE45_LOOKUP.get(character);
      if (value === undefined) throw new Error("接続コードにBase45として解釈できない文字が含まれています。");
      codes.push(value);
    }
    const bytes = [];
    let index = 0;
    for (; index + 2 < codes.length; index += 3) {
      const value = codes[index] + codes[index + 1] * 45 + codes[index + 2] * 2025;
      if (value > 0xffff) throw new Error("接続コードのBase45デコードに失敗しました。");
      bytes.push((value >> 8) & 0xff, value & 0xff);
    }
    const remaining = codes.length - index;
    if (remaining === 2) {
      const value = codes[index] + codes[index + 1] * 45;
      if (value > 0xff) throw new Error("接続コードのBase45デコードに失敗しました。");
      bytes.push(value);
    } else if (remaining !== 0) {
      throw new Error("接続コードの長さが正しくありません。");
    }
    return Uint8Array.from(bytes);
  }

  async function gzip(bytes) {
    const compressed = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
    return new Uint8Array(await new Response(compressed).arrayBuffer());
  }

  async function gunzip(bytes) {
    const decompressed = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Uint8Array(await new Response(decompressed).arrayBuffer());
  }

  async function encodeSignal(value) {
    const raw = new TextEncoder().encode(JSON.stringify(value));
    if ("CompressionStream" in window && "DecompressionStream" in window) {
      try {
        const compressed = await gzip(raw);
        if (compressed.length < raw.length) {
          return `${SIGNAL_PREFIX}:g:${base45Encode(compressed)}`;
        }
      } catch (_error) {
        // 圧縮非対応の実装では非圧縮形式にフォールバックする。
      }
    }
    return `${SIGNAL_PREFIX}:n:${base45Encode(raw)}`;
  }

  async function decodeSignal(code) {
    // Base45は半角スペースを有効な符号として使う。QRスキャン結果は前後に余分な
    // 空白が付かないため、ここでは改行・タブだけを除き、末尾の空白は保持する
    // （末尾のtrimは貼り付け操作側でのみ行う）。
    const compact = String(code).replace(/[\r\n\t]+/g, "");
    const match = compact.match(/^ITOP2P1:([gn]):([0-9A-Z $%*+./:-]+)$/);
    if (!match) throw new Error("ito P2P用の接続コードではありません。");
    let bytes = base45Decode(match[2]);
    if (match[1] === "g") {
      if (!("DecompressionStream" in window)) {
        throw new Error("このブラウザは圧縮された接続コードを展開できません。ブラウザを更新してください。");
      }
      bytes = await gunzip(bytes);
    }
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || value.version !== 1 || !value.kind || !value.description) {
      throw new Error("接続コードの内容が正しくありません。");
    }
    return value;
  }

  function splitForQr(code) {
    // QRはAlphanumericモード（大文字英数字のみ）で符号化するため、transferIdも大文字に揃える。
    const transferId = createId().replace(/-/g, "").slice(0, 8).toUpperCase();
    const pieces = [];
    for (let index = 0; index < code.length; index += QR_CHUNK_SIZE) {
      pieces.push(code.slice(index, index + QR_CHUNK_SIZE));
    }
    return pieces.map((piece, index) => (
      `${SIGNAL_PREFIX}Q:${transferId}:${index + 1}:${pieces.length}:${piece}`
    ));
  }

  function renderCurrentQr() {
    const value = currentQrChunks[currentQrIndex];
    if (!value) return;
    try {
      const qr = qrcode(0, "M");
      qr.addData(value, "Alphanumeric");
      qr.make();
      elements.qrDisplay.innerHTML = qr.createSvgTag(5, 3);
    } catch (error) {
      elements.qrDisplay.textContent = "QRコードを生成できませんでした。下の接続コードを利用してください。";
      console.error(error);
    }
    elements.qrPageLabel.textContent = `${currentQrIndex + 1} / ${currentQrChunks.length}`;
    elements.prevQrBtn.disabled = currentQrIndex === 0;
    elements.nextQrBtn.disabled = currentQrIndex === currentQrChunks.length - 1;
    elements.qrPager.classList.toggle("hidden", currentQrChunks.length <= 1);
  }

  function buildInviteUrl(code) {
    return `${location.origin}${location.pathname}#i=${encodeURIComponent(code)}`;
  }

  function displaySignal({ title, instruction, code, shareUrl = null, nextAction = false }) {
    openDialog();
    stopCamera();
    elements.dialogTitle.textContent = title;
    elements.displayInstruction.textContent = instruction;
    elements.outgoingSignalText.value = code;
    elements.displayNextActionBtn.classList.toggle("hidden", !nextAction);
    elements.shareLinkBlock.classList.toggle("hidden", !shareUrl);
    if (shareUrl) {
      elements.shareLinkInput.value = shareUrl;
      elements.shareLinkBtn.classList.toggle("hidden", !navigator.share);
    }
    currentSignalCode = code;
    currentQrChunks = splitForQr(code);
    currentQrIndex = 0;
    renderCurrentQr();
    setPane(elements.signalDisplay);
  }

  async function copyText(button, text) {
    try {
      await navigator.clipboard.writeText(text);
      const original = button.textContent;
      button.textContent = "コピーしました";
      setTimeout(() => { button.textContent = original; }, 1400);
      return true;
    } catch (_error) {
      return false;
    }
  }

  async function copyCurrentSignal() {
    if (!(await copyText(elements.copySignalBtn, currentSignalCode))) {
      elements.outgoingSignalText.focus();
      elements.outgoingSignalText.select();
    }
  }

  async function copyShareLink() {
    if (!(await copyText(elements.shareLinkCopyBtn, elements.shareLinkInput.value))) {
      elements.shareLinkInput.focus();
      elements.shareLinkInput.select();
    }
  }

  async function shareInviteLink() {
    if (!navigator.share) return;
    try {
      await navigator.share({ title: "ito P2Pに参加する", url: elements.shareLinkInput.value });
    } catch (_error) {
      // ユーザーが共有シートを閉じた場合などは何もしない。
    }
  }

  async function copyDiagnosticResult() {
    if (!activeDiagnosticPeer?.debug) return;
    updateDiagnosticPanel(activeDiagnosticPeer);
    const value = elements.diagnosticText.textContent;
    try {
      await navigator.clipboard.writeText(value);
      const original = elements.copyDiagnosticBtn.textContent;
      elements.copyDiagnosticBtn.textContent = "コピーしました";
      setTimeout(() => { elements.copyDiagnosticBtn.textContent = original; }, 1400);
    } catch (_error) {
      window.prompt("下の診断結果をコピーしてください", value);
    }
  }

  function collectQrData(rawValue) {
    const value = String(rawValue).trim();
    if (value.startsWith(`${SIGNAL_PREFIX}:`)) return value;
    const match = value.match(/^ITOP2P1Q:([^:]+):(\d+):(\d+):(.+)$/);
    if (!match) throw new Error("ito P2P用のQRコードではありません。");

    const transferId = match[1];
    const part = Number(match[2]);
    const total = Number(match[3]);
    if (!Number.isInteger(part) || !Number.isInteger(total) || part < 1 || part > total || total > 20) {
      throw new Error("分割QRコードの番号が正しくありません。");
    }
    if (!chunkAccumulator || chunkAccumulator.id !== transferId) {
      chunkAccumulator = { id: transferId, total, parts: new Map() };
      scannedChunkSet = new Set();
    }
    if (chunkAccumulator.total !== total) throw new Error("異なる接続QRが混ざっています。");
    chunkAccumulator.parts.set(part, match[4]);
    elements.scanProgress.textContent = `${chunkAccumulator.parts.size} / ${total} 枚読み取り済み。送信側で次のQRを表示してください。`;
    if (chunkAccumulator.parts.size < total) return null;

    let complete = "";
    for (let index = 1; index <= total; index += 1) {
      const piece = chunkAccumulator.parts.get(index);
      if (!piece) return null;
      complete += piece;
    }
    return complete;
  }

  async function acceptScannedValue(rawValue) {
    if (scannerBusy || scannedChunkSet.has(rawValue)) return;
    scannedChunkSet.add(rawValue);
    try {
      const completeCode = collectQrData(rawValue);
      if (!completeCode) return;
      scannerBusy = true;
      stopCamera();
      const value = await decodeSignal(completeCode);
      if (value.kind !== expectedSignalKind) {
        throw new Error(expectedSignalKind === "offer"
          ? "これは招待QRではありません。ホスト側のQRを読み取ってください。"
          : "これは回答QRではありません。参加側のQRを読み取ってください。");
      }
      await handleIncomingSignal(value);
    } catch (error) {
      showSignalError(error);
    } finally {
      scannerBusy = false;
    }
  }

  function scanVideoFrame() {
    if (!scannerStream || scannerBusy) return;
    const video = elements.scannerVideo;
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
      const maxSide = 960;
      const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
      const width = Math.max(1, Math.round(video.videoWidth * scale));
      const height = Math.max(1, Math.round(video.videoHeight * scale));
      const canvas = elements.scannerCanvas;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(video, 0, 0, width, height);
      const imageData = context.getImageData(0, 0, width, height);
      const result = typeof jsQR === "function"
        ? jsQR(imageData.data, width, height, { inversionAttempts: "dontInvert" })
        : null;
      if (result && result.data) void acceptScannedValue(result.data);
    }
    scannerFrame = requestAnimationFrame(scanVideoFrame);
  }

  async function startCamera() {
    stopCamera();
    if (!navigator.mediaDevices?.getUserMedia) {
      elements.scanProgress.textContent = "カメラを利用できません。下の欄へ接続コードを貼り付けてください。";
      return;
    }
    try {
      scannerStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" } },
      });
      elements.scannerVideo.srcObject = scannerStream;
      await elements.scannerVideo.play();
      elements.scanProgress.textContent = "QRコードを枠の中に映してください。";
      scannerFrame = requestAnimationFrame(scanVideoFrame);
    } catch (error) {
      elements.scanProgress.textContent = "カメラを開始できません。権限を確認するか、接続コードを貼り付けてください。";
      console.error(error);
    }
  }

  function stopCamera() {
    if (scannerFrame) cancelAnimationFrame(scannerFrame);
    scannerFrame = 0;
    if (scannerStream) {
      scannerStream.getTracks().forEach((track) => track.stop());
      scannerStream = null;
    }
    elements.scannerVideo.srcObject = null;
  }

  function openScanner(kind) {
    expectedSignalKind = kind;
    if (kind === "offer" && mode === "setup") {
      activeDiagnosticPeer = null;
      elements.diagnosticDetails.classList.add("hidden");
    } else if (kind === "answer" && pendingHostPeer) {
      setActiveDiagnosticPeer(pendingHostPeer);
    }
    scannerBusy = false;
    scannedChunkSet = new Set();
    chunkAccumulator = null;
    elements.incomingSignalText.value = "";
    elements.scanProgress.textContent = "";
    elements.dialogTitle.textContent = kind === "offer" ? "招待QRを読み取る" : "回答QRを読み取る";
    elements.scannerInstruction.textContent = kind === "offer"
      ? "ホスト端末に表示された招待QRを読み取ってください。"
      : "参加端末に表示された回答QRを読み取ってください。";
    openDialog();
    setPane(elements.signalScanner);
    void startCamera();
  }

  function showSessionScreen() {
    elements.setupScreen.classList.add("hidden");
    elements.sessionScreen.classList.remove("hidden");
    elements.addPeerBtn.classList.toggle("hidden", mode !== "host");
    elements.scanAnswerBtn.classList.toggle("hidden", mode !== "host" || !pendingHostPeer);
    elements.networkModeBadge.textContent = useStunForSession ? "STUNあり" : "同じWi-Fi向け";
    setConnectionStatus(mode === "host" ? "ホストとして接続中" : "ホストと接続中", "online");
    void requestWakeLock();
  }

  async function createRoom() {
    elements.createRoomBtn.disabled = true;
    try {
      const topics = await loadTopics();
      mode = "host";
      selfId = HOST_ID;
      sessionId = createId();
      useStunForSession = elements.useStun.checked;
      game = new ItoGameCore.ItoGame({ hostId: HOST_ID, topics });
      game.addPlayer({ id: HOST_ID, name: elements.hostName.value, role: "player", isHost: true });
      showSessionScreen();
      syncAllStates();
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
      mode = "setup";
      elements.createRoomBtn.disabled = false;
    }
  }

  function closePendingHostPeer() {
    if (!pendingHostPeer || pendingHostPeer.playerId) return;
    pendingHostPeer.closedByHost = true;
    clearConnectionTimer(pendingHostPeer);
    try { pendingHostPeer.channel?.close(); } catch (_error) {}
    try { pendingHostPeer.pc.close(); } catch (_error) {}
    hostPeers.delete(pendingHostPeer.connectionId);
    pendingHostPeer = null;
    elements.scanAnswerBtn.classList.add("hidden");
  }

  async function createInvite() {
    if (mode !== "host") return;
    closePendingHostPeer();
    showPreparing("招待を作成", "この端末の接続情報を集めています…");
    try {
      const pc = createPeerConnection(useStunForSession);
      const connectionId = createId();
      const peer = {
        connectionId,
        pc,
        channel: pc.createDataChannel("ito-game", { ordered: true }),
        playerId: null,
        disconnectTimer: 0,
        connectionTimer: 0,
        handledLost: false,
        closedByHost: false,
      };
      pendingHostPeer = peer;
      hostPeers.set(connectionId, peer);
      attachPeerDiagnostics(peer, "ホスト端末", useStunForSession);
      bindHostPeer(peer);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGathering(peer);
      const code = await encodeSignal({
        version: 1,
        kind: "offer",
        sessionId,
        useStun: useStunForSession,
        description: pc.localDescription.toJSON ? pc.localDescription.toJSON() : pc.localDescription,
        diagnostics: exportSignalDiagnostics(peer),
      });
      elements.scanAnswerBtn.classList.remove("hidden");
      displaySignal({
        title: "招待",
        instruction: "招待リンクを参加者に送ってください。開くだけで参加準備ができ、QRを読み取ってもらう必要がありません。リンクを使えない場合はQRを読み取ってもらいます。",
        code,
        shareUrl: buildInviteUrl(code),
        nextAction: true,
      });
    } catch (error) {
      closePendingHostPeer();
      showSignalError(error, false);
    }
  }

  function clearConnectionTimer(peer) {
    clearTimeout(peer.connectionTimer);
    peer.connectionTimer = 0;
  }

  function showConnectionFailure(peer, reason) {
    if (!peer?.debug || peer.debug.connectionFailureShown) return;
    peer.debug.connectionFailureShown = true;
    peer.debug.failureReason = reason;
    clearConnectionTimer(peer);
    setActiveDiagnosticPeer(peer);
    updateDiagnosticPanel(peer);
    const assessment = diagnosticAssessment(peer);
    elements.diagnosticDetails.open = true;
    showSignalError(
      new Error(`${reason}\n\n${assessment.hint}`),
      false,
      "P2P接続に失敗しました",
    );
  }

  function startConnectionTimer(peer) {
    clearConnectionTimer(peer);
    peer.connectionTimer = setTimeout(() => {
      if (peer.channel?.readyState === "open" || peer.pc.connectionState === "connected") return;
      peer.debug.connectionTimedOut = true;
      updateDiagnosticPanel(peer);
      showConnectionFailure(peer, `${Math.round(CONNECTION_TIMEOUT / 1000)}秒以内に直接通信経路を確立できませんでした。`);
    }, CONNECTION_TIMEOUT);
  }

  function bindHostPeer(peer) {
    const { pc, channel } = peer;
    channel.onopen = () => {
      clearConnectionTimer(peer);
      sendJson(channel, { type: "HOST_READY", sessionId });
      elements.preparingText.textContent = "参加端末からプロフィールを受信しています…";
    };
    channel.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch (_error) {
        return;
      }
      if (message.type === "HELLO") {
        if (!peer.playerId) {
          const playerId = createId();
          const player = game.addPlayer({
            id: playerId,
            name: message.name,
            role: message.role,
          });
          peer.playerId = playerId;
          peer.handledLost = false;
          sendJson(channel, {
            type: "WELCOME",
            playerId,
            sessionId,
            acceptedRole: player.role,
          });
          if (pendingHostPeer === peer) pendingHostPeer = null;
          elements.scanAnswerBtn.classList.add("hidden");
          showNotice(`${player.name}さんが接続しました。`);
          closeDialog();
          syncAllStates();
        }
        return;
      }
      if (!peer.playerId) return;
      if (message.type === "ACTION") {
        const result = game.action(peer.playerId, message.action);
        if (!result.ok) sendJson(channel, { type: "ERROR", message: result.reason });
        syncAllStates();
      } else if (message.type === "LEAVE") {
        peer.closedByHost = true;
        handleHostPeerLost(peer, true);
      }
    };
    channel.onclose = () => handleHostPeerLost(peer);
    pc.onconnectionstatechange = () => handleHostConnectionState(peer);
    pc.addEventListener("iceconnectionstatechange", () => {
      if (pc.iceConnectionState === "failed" && !peer.playerId && !peer.closedByHost) {
        showConnectionFailure(peer, "ICE接続確認がfailedになりました。利用可能な候補ペアがありません。");
      }
    });
  }

  function handleHostConnectionState(peer) {
    const state = peer.pc.connectionState;
    if (state === "connected") {
      clearConnectionTimer(peer);
      clearTimeout(peer.disconnectTimer);
      peer.disconnectTimer = 0;
      return;
    }
    if (state === "failed" || state === "closed") {
      if (!peer.playerId && !peer.closedByHost) {
        showConnectionFailure(peer, `P2P接続状態が${state}になりました。`);
      } else {
        handleHostPeerLost(peer);
      }
    } else if (state === "disconnected" && !peer.disconnectTimer) {
      peer.disconnectTimer = setTimeout(() => {
        if (peer.pc.connectionState === "disconnected") handleHostPeerLost(peer);
      }, 5000);
    }
  }

  function handleHostPeerLost(peer, immediate = false) {
    if (peer.handledLost) return;
    if (!immediate && peer.pc.connectionState === "connected") return;
    peer.handledLost = true;
    clearConnectionTimer(peer);
    clearTimeout(peer.disconnectTimer);
    hostPeers.delete(peer.connectionId);
    if (pendingHostPeer === peer) {
      pendingHostPeer = null;
      elements.scanAnswerBtn.classList.add("hidden");
    }
    if (!peer.playerId || !game) return;
    const player = game.getPlayer(peer.playerId);
    if (!player) return;
    if (game.phase === "lobby") {
      game.removePlayer(peer.playerId);
      showNotice(`${player.name}さんが退出しました。`);
    } else {
      game.setConnected(peer.playerId, false);
    }
    syncAllStates();
  }

  async function handleOffer(signal) {
    if (guestPeer) {
      clearConnectionTimer(guestPeer);
      try { guestPeer.channel?.close(); } catch (_error) {}
      try { guestPeer.pc.close(); } catch (_error) {}
    }
    sessionId = signal.sessionId;
    useStunForSession = Boolean(signal.useStun);
    showPreparing("回答QRを作成", "ホストの接続情報を確認しています…");

    const pc = createPeerConnection(useStunForSession);
    const peer = { pc, channel: null, welcomed: false, connectionTimer: 0 };
    guestPeer = peer;
    attachPeerDiagnostics(peer, "参加端末", useStunForSession);
    peer.debug.remoteSignal = signal.diagnostics || null;
    updateDiagnosticPanel(peer);
    pc.ondatachannel = (event) => bindGuestChannel(peer, event.channel);
    pc.onconnectionstatechange = () => handleGuestConnectionState(peer);
    await pc.setRemoteDescription(signal.description);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitForIceGathering(peer);
    const code = await encodeSignal({
      version: 1,
      kind: "answer",
      sessionId,
      description: pc.localDescription.toJSON ? pc.localDescription.toJSON() : pc.localDescription,
      diagnostics: exportSignalDiagnostics(peer),
    });
    elements.guestConnectStatus.textContent = "回答QRをホストに読み取ってもらってください。";
    displaySignal({
      title: "回答QR",
      instruction: "このQRをホスト端末で読み取ってください。読み取り後、自動的にロビーへ入ります。",
      code,
      nextAction: false,
    });
  }

  function bindGuestChannel(peer, channel) {
    peer.channel = channel;
    channel.onopen = () => {
      clearConnectionTimer(peer);
      elements.guestConnectStatus.textContent = "ホストへ接続しました。参加登録中…";
      sendGuestHello();
    };
    channel.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch (_error) {
        return;
      }
      if (message.type === "HOST_READY") {
        sendGuestHello();
      } else if (message.type === "WELCOME") {
        if (message.sessionId !== sessionId) return;
        selfId = message.playerId;
        mode = "guest";
        peer.welcomed = true;
        showSessionScreen();
        closeDialog();
        elements.guestConnectStatus.textContent = "";
        if (message.acceptedRole !== guestProfile.role) {
          showNotice("ゲーム進行中または定員のため、観戦者として参加しました。");
        }
      } else if (message.type === "STATE") {
        if (!peer.welcomed && selfId) peer.welcomed = true;
        currentState = message.state;
        renderState(currentState);
      } else if (message.type === "ERROR") {
        showNotice(message.message);
      }
    };
    channel.onclose = () => handleGuestDisconnected();
  }

  function sendGuestHello() {
    if (!guestPeer?.channel || !guestProfile) return;
    sendJson(guestPeer.channel, {
      type: "HELLO",
      sessionId,
      name: guestProfile.name,
      role: guestProfile.role,
    });
  }

  function handleGuestConnectionState(peer) {
    const state = peer.pc.connectionState;
    if (state === "failed") {
      if (mode === "guest") handleGuestDisconnected();
      else updateDiagnosticPanel(peer);
    }
    if (state === "closed" && mode === "guest") handleGuestDisconnected();
    if (state === "disconnected") {
      setConnectionStatus("接続が不安定です", "offline");
    }
    if (state === "connected" && mode === "guest") {
      clearConnectionTimer(peer);
      setConnectionStatus("ホストと接続中", "online");
    }
  }

  function handleGuestDisconnected() {
    if (guestPeer) clearConnectionTimer(guestPeer);
    if (mode !== "guest") {
      elements.guestConnectStatus.textContent = "接続できませんでした。もう一度QR交換を行ってください。";
      return;
    }
    setConnectionStatus("ホストとの接続が切れました", "offline");
    showNotice("ホストとの接続が切れました。続けるにはページを再読み込みして接続し直してください。");
  }

  async function handleAnswer(signal) {
    if (!pendingHostPeer) throw new Error("回答を待っている招待がありません。招待QRを作り直してください。");
    if (signal.sessionId !== sessionId) throw new Error("別の部屋に対する回答QRです。");
    showPreparing("P2P接続中", "端末同士の通信経路を確認しています…");
    pendingHostPeer.debug.remoteSignal = signal.diagnostics || null;
    setActiveDiagnosticPeer(pendingHostPeer);
    await pendingHostPeer.pc.setRemoteDescription(signal.description);
    updateDiagnosticPanel(pendingHostPeer);
    startConnectionTimer(pendingHostPeer);
  }

  async function handleIncomingSignal(signal) {
    if (signal.kind === "offer") await handleOffer(signal);
    else if (signal.kind === "answer") await handleAnswer(signal);
    else throw new Error("未対応の接続情報です。");
  }

  async function tryLoadOfferFromUrl() {
    const match = location.hash.match(/^#i=(.+)$/);
    if (!match) return;
    try {
      const signal = await decodeSignal(decodeURIComponent(match[1]));
      if (signal.kind !== "offer") return;
      pendingUrlOffer = signal;
      elements.joinRoomBtn.textContent = "参加する";
      elements.guestPanelHint.textContent = "招待リンクから開きました。QRを読み取る必要はありません。";
      elements.guestConnectStatus.textContent = "表示名を入れて「参加する」を押してください。";
    } catch (error) {
      elements.guestConnectStatus.textContent = "招待リンクを読み込めませんでした。QRで参加してください。";
      console.error(error);
    }
  }

  function syncAllStates() {
    if (mode !== "host" || !game) return;
    for (const peer of hostPeers.values()) {
      if (!peer.playerId) continue;
      sendJson(peer.channel, { type: "STATE", state: game.stateFor(peer.playerId) });
    }
    currentState = game.stateFor(HOST_ID);
    renderState(currentState);
  }

  function performAction(action) {
    if (mode === "host") {
      const result = game.action(HOST_ID, action);
      if (!result.ok) showNotice(result.reason);
      syncAllStates();
    } else if (!sendJson(guestPeer?.channel, { type: "ACTION", action })) {
      showNotice("ホストと接続されていません。");
    }
  }

  function renderRoster(container, players, emptyText) {
    container.replaceChildren();
    if (!players.length) {
      const empty = document.createElement("p");
      empty.className = "empty-roster";
      empty.textContent = emptyText;
      container.appendChild(empty);
      return;
    }
    for (const player of players) {
      const row = document.createElement("div");
      row.className = "roster-item";
      const slot = document.createElement("span");
      slot.className = "slot-number";
      slot.textContent = player.role === "player" ? `${player.slot}P` : "●";
      const name = document.createElement("span");
      name.className = "player-name";
      name.textContent = `${player.name}${player.id === selfId ? "（あなた）" : ""}`;
      const state = document.createElement("span");
      state.className = `player-state${player.connected ? "" : " disconnected"}`;
      state.textContent = player.connected ? (player.isHost ? "HOST" : "ONLINE") : "OFFLINE";
      row.append(slot, name, state);
      container.appendChild(row);
    }
  }

  function makeMiniCard(entry, index) {
    const card = document.createElement("div");
    card.className = `mini-card${entry.wrong ? " wrong" : ""}`;
    card.style.animationDelay = `${Math.min(index * 70, 420)}ms`;
    const owner = document.createElement("span");
    owner.textContent = entry.slot ? `${entry.slot}P` : entry.name;
    const number = document.createElement("strong");
    number.textContent = entry.card;
    card.append(owner, number);
    return card;
  }

  function renderCards(container, cards) {
    container.replaceChildren();
    container.classList.toggle("empty-cards", cards.length === 0);
    cards.forEach((entry, index) => container.appendChild(makeMiniCard(entry, index)));
  }

  function showGameView(active) {
    [elements.lobbyView, elements.confirmView, elements.discussionView, elements.resultView]
      .forEach((view) => view.classList.toggle("hidden", view !== active));
  }

  function renderLobby(state) {
    showGameView(elements.lobbyView);
    const players = state.players.filter((player) => player.role === "player");
    const spectators = state.players.filter((player) => player.role === "spectator");
    const connectedPlayers = players.filter((player) => player.connected);
    elements.playerCountBadge.textContent = `${connectedPlayers.length}人`;
    renderRoster(elements.playerList, players, "まだプレイヤーはいません");
    renderRoster(elements.spectatorList, spectators, "観戦者はいません");
    if (state.isHost) {
      elements.lobbyActionTitle.textContent = connectedPlayers.length >= 2 ? "準備ができました" : "あと1人必要です";
      elements.lobbyActionText.textContent = connectedPlayers.length >= 2
        ? "全員そろったらゲームを開始してください。"
        : "「参加者を追加」から招待QRを表示してください。";
      elements.startGameBtn.classList.remove("hidden");
      elements.startGameBtn.disabled = connectedPlayers.length < 2;
    } else {
      elements.lobbyActionTitle.textContent = "ホストの開始を待っています";
      elements.lobbyActionText.textContent = "参加者がそろうと、ホストがゲームを開始します。";
      elements.startGameBtn.classList.add("hidden");
    }
  }

  function renderConfirm(state) {
    showGameView(elements.confirmView);
    const total = state.roundPlayerIds.length;
    elements.confirmProgress.textContent = `${state.confirmedCount} / ${total}`;
    const isParticipant = state.selfCard !== null;
    elements.privateCard.classList.toggle("hidden", !isParticipant);
    elements.confirmNumberBtn.classList.toggle("hidden", !isParticipant || state.selfConfirmed);
    elements.confirmNumberBtn.disabled = state.selfConfirmed;
    if (isParticipant) {
      elements.privateCardSlot.textContent = `${state.self.slot}P`;
      elements.privateCardNumber.textContent = state.selfCard;
      elements.confirmInstruction.textContent = state.selfConfirmed ? "ほかの人の確認を待っています" : "数字を覚えてください";
      elements.confirmWaitingText.textContent = state.selfConfirmed ? "確認済みです。全員が確認すると相談が始まります。" : "";
    } else {
      elements.confirmInstruction.textContent = "観戦中です";
      elements.confirmWaitingText.textContent = "全プレイヤーが数字を確認するまでお待ちください。";
    }
  }

  function renderDiscussion(state) {
    showGameView(elements.discussionView);
    const total = state.roundPlayerIds.length;
    elements.revealProgress.textContent = `${state.revealed.length} / ${total}`;
    elements.topicText.textContent = state.topic;
    renderCards(elements.revealedCards, state.revealed);
    const isParticipant = state.selfCard !== null;
    if (!isParticipant) {
      elements.handCard.classList.add("hidden");
      elements.handTitle.textContent = "観戦中です";
      elements.handDescription.textContent = "相談とカードの公開順を見守りましょう。";
      elements.revealCardBtn.classList.add("hidden");
    } else if (state.selfRevealed) {
      elements.handCard.classList.add("hidden");
      elements.handTitle.textContent = "公開済みです";
      elements.handDescription.textContent = "ほかのプレイヤーが公開するのを待っています。";
      elements.revealCardBtn.classList.add("hidden");
    } else {
      elements.handCard.classList.remove("hidden");
      elements.handCardSlot.textContent = `${state.self.slot}P`;
      elements.handCardNumber.textContent = state.selfCard;
      elements.handTitle.textContent = "あなたの手札";
      elements.handDescription.textContent = "順番が来たと思ったら公開してください。";
      elements.revealCardBtn.classList.remove("hidden");
      elements.revealCardBtn.disabled = false;
    }
  }

  function renderResult(state) {
    showGameView(elements.resultView);
    const success = Boolean(state.result?.success);
    elements.resultHero.classList.toggle("success", success);
    elements.resultHero.classList.toggle("failure", !success);
    elements.resultTitle.textContent = success ? "成功！" : "失敗…";
    elements.resultSubtitle.textContent = success
      ? "みんなの感覚がきれいにそろいました。"
      : "赤いカードの順番が入れ替わっていました。";
    renderCards(elements.resultCards, state.result?.cards || []);
    elements.resultWaiting.classList.toggle("hidden", state.isHost);
    elements.restartGameBtn.classList.toggle("hidden", !state.isHost);
    elements.backToLobbyBtn.classList.toggle("hidden", !state.isHost);
  }

  function renderState(state) {
    if (!state) return;
    showNotice(state.notice || elements.notice.textContent);
    if (state.phase === "lobby") renderLobby(state);
    else if (state.phase === "confirm") renderConfirm(state);
    else if (state.phase === "discussion") renderDiscussion(state);
    else if (state.phase === "result") renderResult(state);
  }

  async function requestWakeLock() {
    if (!("wakeLock" in navigator) || document.visibilityState !== "visible" || mode === "setup") return;
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    } catch (_error) {
      // 省電力設定などで拒否されてもゲーム自体は続行できる。
    }
  }

  function releaseWakeLock() {
    if (wakeLock) void wakeLock.release();
    wakeLock = null;
  }

  function shutdownSession() {
    if (mode === "guest") sendJson(guestPeer?.channel, { type: "LEAVE" });
    for (const peer of hostPeers.values()) {
      peer.closedByHost = true;
      clearConnectionTimer(peer);
      clearTimeout(peer.disconnectTimer);
      try { peer.channel?.close(); } catch (_error) {}
      try { peer.pc.close(); } catch (_error) {}
    }
    hostPeers.clear();
    if (guestPeer) {
      clearConnectionTimer(guestPeer);
      try { guestPeer.channel?.close(); } catch (_error) {}
      try { guestPeer.pc.close(); } catch (_error) {}
    }
    stopCamera();
    releaseWakeLock();
  }

  elements.createRoomBtn.addEventListener("click", () => void createRoom());
  elements.joinRoomBtn.addEventListener("click", () => {
    guestProfile = {
      name: ItoGameCore.cleanName(elements.guestName.value, "ゲスト"),
      role: elements.guestRole.value === "spectator" ? "spectator" : "player",
    };
    if (pendingUrlOffer) {
      elements.guestConnectStatus.textContent = "ホストに接続しています…";
      void handleIncomingSignal(pendingUrlOffer).catch((error) => showSignalError(error, false));
    } else {
      elements.guestConnectStatus.textContent = "招待QRを読み取ってください。";
      openScanner("offer");
    }
  });
  elements.addPeerBtn.addEventListener("click", () => void createInvite());
  elements.scanAnswerBtn.addEventListener("click", () => openScanner("answer"));
  elements.displayNextActionBtn.addEventListener("click", () => openScanner("answer"));
  elements.shareLinkCopyBtn.addEventListener("click", () => void copyShareLink());
  elements.shareLinkBtn.addEventListener("click", () => void shareInviteLink());
  elements.closeDialogBtn.addEventListener("click", closeDialog);
  elements.signalDialog.addEventListener("close", stopCamera);
  elements.prevQrBtn.addEventListener("click", () => {
    currentQrIndex = Math.max(0, currentQrIndex - 1);
    renderCurrentQr();
  });
  elements.nextQrBtn.addEventListener("click", () => {
    currentQrIndex = Math.min(currentQrChunks.length - 1, currentQrIndex + 1);
    renderCurrentQr();
  });
  elements.copySignalBtn.addEventListener("click", () => void copyCurrentSignal());
  elements.copyDiagnosticBtn.addEventListener("click", () => void copyDiagnosticResult());
  elements.applySignalBtn.addEventListener("click", () => {
    const pasted = elements.incomingSignalText.value.trim();
    if (!pasted) {
      elements.scanProgress.textContent = "接続コードを貼り付けてください。";
      return;
    }
    void acceptScannedValue(pasted);
  });
  elements.retryScanBtn.addEventListener("click", () => openScanner(expectedSignalKind));
  elements.startGameBtn.addEventListener("click", () => performAction("START"));
  elements.confirmNumberBtn.addEventListener("click", () => {
    elements.confirmNumberBtn.disabled = true;
    performAction("CONFIRM");
  });
  elements.revealCardBtn.addEventListener("click", () => {
    if (!confirm("このカードを場に公開しますか？")) return;
    elements.revealCardBtn.disabled = true;
    performAction("REVEAL");
  });
  elements.restartGameBtn.addEventListener("click", () => performAction("RESTART"));
  elements.backToLobbyBtn.addEventListener("click", () => performAction("BACK_TO_LOBBY"));
  elements.leaveSessionBtn.addEventListener("click", () => {
    if (!confirm(mode === "host" ? "退出すると部屋が終了します。よろしいですか？" : "ゲームから退出しますか？")) return;
    shutdownSession();
    location.reload();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && mode !== "setup") void requestWakeLock();
  });
  window.addEventListener("beforeunload", shutdownSession);

  void tryLoadOfferFromUrl();
})();

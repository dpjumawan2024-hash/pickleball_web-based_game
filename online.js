"use strict";
(() => {
  const $ = (id) => document.getElementById(id);
  const onlineScreen = $("online");
  const canvas = $("c");
  const characterStats = window.CourtClashProfile?.getCharacters() || [];
  const input = { x: 0, y: 0, ax: 0, ay: -0.5 };
  const keys = new Set();
  const BALL_INTERPOLATION_DELAY_MS = 80;
  let socket = null;
  let connected = false;
  let active = false;
  let roomCode = "";
  let slot = 0;
  let state = null;
  let visualPlayers = null;
  let ballSnapshots = [];
  let sendElapsed = 0;
  let pointer = null;
  let ignoreNextEnd = false;
  let ballTrail = [];
  let hitEffect = null;
  let previousScore = null;

  function setStatus(message) {
    $("onlineStatus").textContent = message;
  }
  function getCharacterId(player) {
    if (Number.isInteger(player.characterId) &&
        player.characterId >= 0 &&
        player.characterId < characterStats.length) return player.characterId;
    const nameMatch = characterStats.findIndex((character) => character.name === player.characterName);
    return nameMatch >= 0 ? nameMatch : 0;
  }
  function renderCharacters() {
    const profile = window.CourtClashProfile;
    if (!profile) return;
    const characters = profile.getCharacters();
    const selected = profile.getCharacterId();
    const list = $("onlineCharacters");
    list.replaceChildren();
    characters.forEach((character, id) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `online-character${id === selected ? " selected" : ""}`;
      button.setAttribute("aria-pressed", String(id === selected));
      button.setAttribute("aria-label", `${character.name}: ${character.description}, speed ${character.speed}, reach ${character.reach}`);
      const preview = document.createElement("canvas");
      preview.width = preview.height = 120;
      preview.setAttribute("aria-hidden", "true");
      profile.drawCharacterPreview(preview.getContext("2d"), id);
      const name = document.createElement("strong");
      name.textContent = character.name;
      const description = document.createElement("span");
      description.textContent = character.description;
      button.append(preview, name, description);
      button.addEventListener("click", () => profile.selectCharacter(id));
      list.append(button);
    });
    $("onlineCharacterDescription").textContent =
      `${characters[selected].name} · Speed ${characters[selected].speed.toFixed(2)} · Reach ${characters[selected].reach.toFixed(1)}`;
  }
  renderCharacters();
  function wsUrl() {
    if (location.protocol === "file:") return "ws://localhost:3000/online";
    return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/online`;
  }
  function showOnline() {
    $("menu").classList.add("hide");
    $("msgov").classList.add("hide");
    onlineScreen.classList.remove("hide");
    $("onlineTitle").textContent = "Online multiplayer";
    $("onlineLobby").classList.remove("hide");
    $("onlineRoom").classList.add("hide");
    $("onlineLeave").textContent = "Back to menu";
    $("onlineRequests").replaceChildren();
    setStatus("Choose your character, connect, then create or join a room.");
    window.CourtClashUI?.updateTouchControls();
  }
  function toMenu() {
    active = false;
    state = null;
    roomCode = "";
    input.x = input.y = 0;
    $("online").classList.add("hide");
    $("onlineLobby").classList.remove("hide");
    $("onlineRoom").classList.add("hide");
    $("onlineRequests").replaceChildren();
    $("menu").classList.remove("hide");
    window.CourtClashUI?.updateTouchControls();
  }
  function renderPublicRooms(rooms) {
    const list = $("publicRooms");
    list.replaceChildren();
    if (!connected) {
      list.append(Object.assign(document.createElement("span"), { textContent: "Connect to browse public rooms." }));
      return;
    }
    if (!rooms.length) {
      list.append(Object.assign(document.createElement("span"), { textContent: "No public rooms are waiting." }));
      return;
    }
    rooms.forEach((room) => {
      const row = document.createElement("div");
      row.className = "public-room-entry";
      const description = document.createElement("span");
      description.textContent = `${room.gameType === "doubles" ? "2v2" : "1v1"} · ${room.scoring === "official" ? "Official side-out" : "Fair rally"} · ${room.players}/${room.maxPlayers} players`;
      const joinButton = document.createElement("button");
      joinButton.type = "button";
      joinButton.className = "btn";
      joinButton.textContent = "Join";
      joinButton.dataset.roomCode = room.code;
      row.append(description, joinButton);
      list.append(row);
    });
  }
  function renderRoom(room) {
    roomCode = room.code;
    slot = room.slot;
    $("onlineRoomCode").textContent = room.code;
    $("onlineRoomCodeLabel").textContent = room.visibility === "private" ? "Private room code" : "Public room code";
    $("onlineRoomInfo").textContent = `${room.gameType === "doubles" ? "2v2" : "1v1"} · ${room.scoring === "official" ? "Official side-out scoring" : "Fair rally scoring"} · ${room.visibility}`;
    const players = room.players.filter(Boolean);
    $("onlinePlayers").textContent = `${players.length}/${room.maxPlayers} players: ${players.map((entry) => `${entry.name} (${entry.characterName})`).join(", ") || "Waiting"}`;
    const canHostStart = room.slot === room.hostSlot &&
      room.visibility === "private" &&
      room.gameType === "doubles" &&
      room.status === "waiting";
    $("onlineStart").classList.toggle("hide", !canHostStart);
    $("onlineStart").disabled = players.length !== room.maxPlayers;
    const requestList = $("onlineRequests");
    requestList.replaceChildren();
    if (room.slot === room.hostSlot && room.visibility === "private" && room.status === "waiting") {
      room.pendingRequests.forEach((request) => {
        const row = document.createElement("div");
        row.className = "join-request";
        const name = document.createElement("span");
        name.textContent = `${request.name} wants to join`;
        const accept = document.createElement("button");
        accept.type = "button";
        accept.className = "btn";
        accept.textContent = "Accept";
        accept.dataset.requestId = request.id;
        accept.dataset.requestAction = "accept";
        const decline = document.createElement("button");
        decline.type = "button";
        decline.className = "btn alt";
        decline.textContent = "Decline";
        decline.dataset.requestId = request.id;
        decline.dataset.requestAction = "decline";
        row.append(name, accept, decline);
        requestList.append(row);
      });
    }
    $("onlineLobby").classList.add("hide");
    $("onlineRoom").classList.remove("hide");
    $("onlineTitle").textContent = `Room ${room.code}`;
    if (room.status === "playing") setStatus("Room full. Match starting...");
    else if (room.visibility === "private") setStatus(room.slot === room.hostSlot
      ? room.gameType === "doubles"
        ? "Share the code, accept players, then start when all four seats are filled."
        : "Share the code and accept players when they request to join."
      : "Waiting for the host to accept your request or start the full match.");
    else setStatus("Waiting for players. Public rooms start when full.");
  }
  function connect() {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
    setStatus("Connecting to the online server...");
    try {
      socket = new WebSocket(wsUrl());
    } catch (_) {
      setStatus("Could not connect. Open the game through the online server.");
      return;
    }
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        type: "hello",
        name: window.CourtClashProfile?.getName() || "Player",
        characterName: window.CourtClashProfile?.getCharacterName() || "Character",
        characterId: window.CourtClashProfile?.getCharacterId() || 0,
      }));
    });
    socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch (_) {
        return;
      }
      receive(message);
    });
    socket.addEventListener("close", () => {
      connected = false;
      $("onlineCreate").disabled = true;
      $("onlineJoin").disabled = true;
      $("onlineBrowse").disabled = true;
      if (active) endLocally("Connection lost. The match has ended.");
      else if (!onlineScreen.classList.contains("hide")) setStatus("Connection closed. Check that the online server is running, then reconnect.");
    });
    socket.addEventListener("error", () => {
      setStatus("Could not reach the server. Check the server address and try again.");
    });
  }
  function send(message) {
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }
  window.addEventListener("courtclash:profilechange", () => {
    renderCharacters();
    if (!connected) return;
    send({
      type: "hello",
      name: window.CourtClashProfile?.getName() || "Player",
      characterName: window.CourtClashProfile?.getCharacterName() || "Character",
      characterId: window.CourtClashProfile?.getCharacterId() || 0,
    });
  });
  function receive(message) {
    if (message.type === "connected") return;
    if (message.type === "welcome") {
      connected = true;
      $("onlineCreate").disabled = false;
      $("onlineJoin").disabled = false;
      $("onlineBrowse").disabled = false;
      setStatus(`Connected as ${message.name}. Choose your character, then create or join a room.`);
      return;
    }
    if (message.type === "public-rooms") {
      renderPublicRooms(message.rooms || []);
      return;
    }
    if (message.type === "error") {
      setStatus(message.message || "Online action failed.");
      return;
    }
    if (message.type === "room") {
      renderRoom(message);
      return;
    }
    if (message.type === "join-pending") {
      roomCode = message.code;
      $("onlineLobby").classList.add("hide");
      $("onlineRoom").classList.remove("hide");
      $("onlineTitle").textContent = `Room ${message.code}`;
      $("onlineRoomInfo").textContent = "Private room · awaiting host approval";
      $("onlineRoomCodeLabel").textContent = "Requested room code";
      $("onlineRoomCode").textContent = message.code;
      $("onlinePlayers").textContent = "Your request is waiting for the host.";
      $("onlineRequests").replaceChildren();
      $("onlineStart").classList.add("hide");
      setStatus("Waiting for the host to accept or decline your request.");
      return;
    }
    if (message.type === "join-declined") {
      roomCode = "";
      $("onlineRoom").classList.add("hide");
      $("onlineLobby").classList.remove("hide");
      $("onlineStart").classList.add("hide");
      setStatus(message.message || "The host declined your request.");
      return;
    }
    if (message.type === "join-request") {
      setStatus(`${message.name} requested to join. Review the request below.`);
      return;
    }
    if (message.type === "join-request-cancelled") {
      setStatus("A player cancelled their join request.");
      return;
    }
    if (message.type === "room-left") {
      roomCode = "";
      $("onlineRoom").classList.add("hide");
      $("onlineLobby").classList.remove("hide");
      $("onlineTitle").textContent = "Online multiplayer";
      $("onlineRequests").replaceChildren();
      $("onlineStart").classList.add("hide");
      setStatus(message.reason || "Room closed.");
      return;
    }
    if (message.type === "state") {
      if (state && state.game && message.game &&
          (state.game.score[0] !== message.game.score[0] || state.game.score[1] !== message.game.score[1])) {
        window.CourtClashEffects?.buzz([24, 40, 32]);
      }
      if (message.game?.ball) {
        if (!state?.game ||
            state.game.phase !== message.game.phase ||
            state.game.shots !== message.game.shots) {
          ballSnapshots = [];
          ballTrail = [];
        }
        const ball = message.game.ball;
        ballSnapshots.push({
          receivedAt: performance.now(),
          x: ball.x,
          y: ball.y,
          z: ball.z,
        });
        if (ballSnapshots.length > 8) ballSnapshots.shift();
        ballTrail.push({ x: ball.x, y: ball.y, z: ball.z });
        if (ballTrail.length > 8) ballTrail.shift();
      }
      slot = message.slot;
      roomCode = message.code;
      state = message;
      if (!active && message.status === "playing") startMatch();
      if (!visualPlayers && message.players)
        visualPlayers = message.players.map((player) => player && ({ x: player.x, y: player.y }));
      updateScore();
      window.CourtClashUI?.setOnlinePaused(Boolean(message.game?.paused));
      return;
    }
    if (message.type === "ended") {
      if (ignoreNextEnd) {
        ignoreNextEnd = false;
        return;
      }
      active = false;
      visualPlayers = null;
      window.CourtClashUI?.updateTouchControls();
      $("menu").classList.add("hide");
      onlineScreen.classList.remove("hide");
      $("onlineLobby").classList.add("hide");
      $("onlineRoom").classList.add("hide");
      $("onlineTitle").textContent = message.youWon ? "You win!" : "Match over";
      const team = message.gameType === "doubles" ? Math.floor(slot / 2) : slot;
      const score = message.score ? `${message.score[team]} – ${message.score[1 - team]}. ` : "";
      setStatus(`${score}${message.reason || "Opponent left."}`);
      $("onlineLeave").textContent = "Back to menu";
    }
  }
  function startMatch() {
    active = true;
    visualPlayers = state.players.map((player) => player && ({ x: player.x, y: player.y }));
    $("online").classList.add("hide");
    $("menu").classList.add("hide");
    window.CourtClashUI?.updateTouchControls();
    updateScore();
  }
  function updateScore() {
    if (!state || !state.game) return;
    const team = state.gameType === "doubles" ? Math.floor(slot / 2) : slot;
    const ownSlots = state.gameType === "doubles" ? [team * 2, team * 2 + 1] : [team];
    const opponentTeam = 1 - team;
    const opponentSlots = state.gameType === "doubles" ? [opponentTeam * 2, opponentTeam * 2 + 1] : [opponentTeam];
    const teamName = (slots, fallback) => slots.map((index) => state.players[index]?.name).filter(Boolean).join(" / ") || fallback;
    const mine = teamName(ownSlots, "Your team");
    const opponent = teamName(opponentSlots, "Opponents");
    const scores = state.game.score;
    const status = state.game.paused
      ? "Paused"
      : state.game.message || (state.game.phase === "serve"
        ? `${state.players[state.game.serverSlot]?.name || "Player"} serves${state.scoring === "official" && state.gameType === "doubles" ? ` · server ${state.game.serverNumber}` : ""}`
        : "Rally");
    window.CourtClashUI?.renderScoreboard(
      mine,
      scores[team],
      opponent,
      scores[opponentTeam],
      status,
    );
  }
  function endLocally(message) {
    active = false;
    visualPlayers = null;
    $("menu").classList.add("hide");
    onlineScreen.classList.remove("hide");
    $("onlineLobby").classList.add("hide");
    $("onlineRoom").classList.add("hide");
    $("onlineTitle").textContent = "Match ended";
    setStatus(message);
    $("onlineLeave").textContent = "Back to menu";
    window.CourtClashUI?.updateTouchControls();
  }
  function setMove(x, y) {
    input.x = Math.max(-1, Math.min(1, x));
    input.y = Math.max(-1, Math.min(1, y));
  }
  function hit(aimX, aimY, skill) {
    if (!active) return;
    input.ax = Math.max(-1, Math.min(1, aimX));
    input.ay = Math.max(-1, Math.min(1, aimY));
    window.CourtClashEffects?.audio();
    window.CourtClashEffects?.paddlePop();
    window.CourtClashEffects?.buzz(18);
    hitEffect = 0.18;
    send({ type: "input", ...input, hit: true, skill });
  }
  function getSkillState() {
    return {
      cooldowns: state?.players?.[slot]?.skillCooldowns || { drive: 0, drop: 0, curve: 0 },
      dropAllowed: state?.game?.phase === "rally",
    };
  }
  function update(dt) {
    if (!active || !state) return;
    if (state.game?.paused) return;
    if (hitEffect !== null) hitEffect = Math.max(0, hitEffect - dt);
    const horizontal = (keys.has("d") ? 1 : 0) - (keys.has("a") ? 1 : 0);
    const vertical = (keys.has("s") ? 1 : 0) - (keys.has("w") ? 1 : 0);
    if (!document.getElementById("touchControls").classList.contains("active")) {
      const desktopLayout =
        matchMedia("(min-width:1000px) and (min-height:640px) and (hover:hover) and (pointer:fine)").matches ||
        matchMedia("(orientation:landscape) and (pointer:coarse)").matches;
      input.x = desktopLayout ? vertical : horizontal;
      input.y = desktopLayout ? -horizontal : vertical;
    }
    sendElapsed += dt;
    if (sendElapsed >= 0.05) {
      sendElapsed = 0;
      send({ type: "input", ...input, hit: false });
    }
    if (!visualPlayers) visualPlayers = state.players.map((player) => player && ({ x: player.x, y: player.y }));
    state.players.forEach((player, index) => {
      if (!player) return;
      const current = visualPlayers[index] || (visualPlayers[index] = { x: player.x, y: player.y });
      const predict = index === slot;
      const team = state.gameType === "doubles" ? Math.floor(slot / 2) : slot;
      const orientation = team === 0 ? -1 : 1;
      if (predict) {
        const speed = characterStats[getCharacterId(player)]?.speed || 1;
        current.x += (player.x - current.x) * 0.12 + input.x * orientation * 14 * speed * dt;
        current.y += (player.y - current.y) * 0.12 + input.y * orientation * 14 * speed * dt;
      } else {
        current.x += (player.x - current.x) * 0.24;
        current.y += (player.y - current.y) * 0.24;
      }
    });
  }
  function drawCourt(api, pointAt, sx, sy) {
    const { X, W, H, S, px, py, DESKTOP } = api;
    const transform = (x, y) => {
      const team = state.gameType === "doubles" ? Math.floor(slot / 2) : slot;
      const viewX = team === 0 ? 20 - x : x;
      const viewY = team === 0 ? 44 - y : y;
      return { x: sx(viewX, viewY), y: sy(viewX, viewY) };
    };
    const polygon = (points, fill, stroke) => {
      X.beginPath();
      points.forEach(([x, y], i) => {
        const p = transform(x, y);
        if (i === 0) X.moveTo(p.x, p.y);
        else X.lineTo(p.x, p.y);
      });
      X.closePath();
      X.fillStyle = fill;
      X.fill();
      if (stroke) {
        X.strokeStyle = stroke;
        X.lineWidth = Math.max(2, S * 0.14);
        X.stroke();
      }
    };
    const line = (x1, y1, x2, y2, color, width) => {
      const a = transform(x1, y1);
      const b = transform(x2, y2);
      X.strokeStyle = color;
      X.lineWidth = width;
      X.beginPath();
      X.moveTo(a.x, a.y);
      X.lineTo(b.x, b.y);
      X.stroke();
    };
    X.fillStyle = "#12363f";
    X.fillRect(0, 0, W, H);
    polygon([[-3, -4], [23, -4], [23, 48], [-3, 48]], "#0d2a31");
    polygon([[0, 0], [20, 0], [20, 44], [0, 44]], "#2563a8", "#f4f7f2");
    polygon([[0, 15], [20, 15], [20, 29], [0, 29]], "#2e9b78");
    const me = visualPlayers && visualPlayers[slot];
    if (me && state.game.bounces === 0 && me.y >= 15 && me.y <= 29) {
      polygon([[0, 22], [20, 22], [20, 29], [0, 29]], "rgba(255,70,65,.4)");
    }
    line(0, 15, 20, 15, "#fff", Math.max(2, S * 0.14));
    line(0, 29, 20, 29, "#fff", Math.max(2, S * 0.14));
    line(10, 0, 10, 15, "#fff", Math.max(2, S * 0.14));
    line(10, 29, 10, 44, "#fff", Math.max(2, S * 0.14));
    line(0, 22, 20, 22, "#f4f7f2", Math.max(3, S * 0.2));

    const game = state.game;
    if (game.ball && game.ball.z > 0) {
      const b = game.ball;
      const fall = (b.vz + Math.sqrt(Math.max(0, b.vz * b.vz + 2 * 32 * Math.max(b.z, 0)))) / 32;
      const landing = transform(b.x + b.vx * fall, b.y + b.vy * fall);
      X.strokeStyle = "rgba(232,242,76,.9)";
      X.fillStyle = "rgba(232,242,76,.12)";
      X.lineWidth = Math.max(2, S * 0.12);
      X.beginPath();
      X.ellipse(landing.x, landing.y, S * 1.1, S * 0.7, 0, 0, Math.PI * 2);
      X.fill();
      X.stroke();
    }
    state.players.forEach((player, index) => {
      if (!player) return;
      const actor = visualPlayers && visualPlayers[index] || player;
      const p = transform(actor.x, actor.y);
      const color = index === slot ? "#ff6b57" : "#e8f24c";
      window.CourtClashUI?.drawOnlinePlayer(X, p.x, p.y, S * 0.8, getCharacterId(player), index === slot ? 1 : -1, performance.now() / 1000);
      const label = player.name;
      X.fillStyle = "#fff";
      X.font = `700 ${Math.max(10, Math.round(S * 0.65))}px "Court Sans", sans-serif`;
      X.textAlign = "center";
      const labelWidth = X.measureText(label).width + 12;
      X.fillStyle = "rgba(8,28,34,.78)";
      X.fillRect(p.x - labelWidth / 2, p.y - S * 4.1, labelWidth, 16);
      X.fillStyle = color;
      X.fillText(label, p.x, p.y - S * 3.65, labelWidth - 8);
    });
    const ball = game.ball;
    const renderAt = performance.now() - BALL_INTERPOLATION_DELAY_MS;
    let before = ballSnapshots[0] || ball;
    let after = before;
    for (let index = 1; index < ballSnapshots.length; index++) {
      if (ballSnapshots[index].receivedAt >= renderAt) {
        before = ballSnapshots[index - 1];
        after = ballSnapshots[index];
        break;
      }
      before = ballSnapshots[index];
      after = before;
    }
    const span = after.receivedAt - before.receivedAt;
    const fraction = span > 0
      ? Math.max(0, Math.min(1, (renderAt - before.receivedAt) / span))
      : 0;
    const bx = before.x + (after.x - before.x) * fraction;
    const by = before.y + (after.y - before.y) * fraction;
    const bz = Math.max(0, before.z + (after.z - before.z) * fraction);
    const bscreen = transform(bx, by);
    ballTrail.forEach((point, index) => {
      const trailPoint = transform(point.x, point.y);
      const opacity = (index + 1) / ballTrail.length * 0.32;
      X.fillStyle = `rgba(232,242,76,${opacity})`;
      X.beginPath();
      X.arc(trailPoint.x, trailPoint.y - point.z * S * 0.45, Math.max(1.5, S * 0.15 * opacity * 3), 0, Math.PI * 2);
      X.fill();
    });
    X.fillStyle = "rgba(0,0,0,.3)";
    X.beginPath();
    X.ellipse(bscreen.x, bscreen.y, S * 0.48, S * 0.26, 0, 0, Math.PI * 2);
    X.fill();
    X.fillStyle = "#e8f24c";
    X.beginPath();
    X.arc(bscreen.x, bscreen.y - bz * S * 0.45, S * 0.5, 0, Math.PI * 2);
    X.fill();
    if (hitEffect !== null && hitEffect > 0) {
      X.strokeStyle = `rgba(255,255,255,${hitEffect / 0.18})`;
      X.lineWidth = Math.max(1, S * 0.12);
      X.beginPath();
      X.arc(bscreen.x, bscreen.y - bz * S * 0.45, S * (0.5 + (0.18 - hitEffect) * 5), 0, Math.PI * 2);
      X.stroke();
    }
    if (game.phase === "point") {
      X.fillStyle = "rgba(8,28,34,.78)";
      X.fillRect(W / 2 - 132, H / 2 - 28, 264, 56);
      X.fillStyle = "#e8f24c";
      X.font = '800 18px "Court Sans",sans-serif';
      X.textAlign = "center";
      X.fillText(game.message || "Point", W / 2, H / 2 + 6, 248);
    }
    if (DESKTOP) {
      X.fillStyle = "rgba(255,255,255,.3)";
      X.font = '700 13px "Court Sans",sans-serif';
      X.fillText("WASD move · SPACE hit · Arrows aim", W / 2, H - 16);
    }
  }
  function draw(api) {
    if (!active || !state || !state.game) return;
    drawCourt(api, null, api.screenX, api.screenY);
  }
  function exitRoom(forfeit) {
    if (roomCode && socket && socket.readyState === WebSocket.OPEN) {
      ignoreNextEnd = true;
      send({ type: "leave" });
    }
    if (forfeit) {
      active = false;
      state = null;
      roomCode = "";
      $("menu").classList.remove("hide");
      onlineScreen.classList.add("hide");
      window.CourtClashUI?.updateTouchControls();
    } else toMenu();
  }

  window.OnlineGame = {
    get active() { return active; },
    connect,
    create() { send({ type: "create" }); },
    join(code) { send({ type: "join", code }); },
    hit,
    pause() { send({ type: "pause" }); },
    resume() { send({ type: "resume" }); },
    getSkillState,
    setMove,
    update,
    draw,
    leave: exitRoom,
  };

  $("onlineOpen").addEventListener("click", showOnline);
  $("onlineConnect").addEventListener("click", connect);
  $("onlineCreate").addEventListener("click", () => send({
    type: "create",
    gameType: $("onlineGameType").value,
    scoring: $("onlineScoring").value,
    visibility: $("onlineVisibility").value,
  }));
  $("onlineStart").addEventListener("click", () => send({ type: "start" }));
  $("onlineBrowse").addEventListener("click", () => send({ type: "list-rooms" }));
  $("onlineJoin").addEventListener("click", () => send({ type: "join", code: $("onlineCode").value }));
  $("publicRooms").addEventListener("click", (event) => {
    const button = event.target.closest("[data-room-code]");
    if (button) send({ type: "join", code: button.dataset.roomCode });
  });
  $("onlineRequests").addEventListener("click", (event) => {
    const button = event.target.closest("[data-request-action]");
    if (button) send({ type: button.dataset.requestAction, id: button.dataset.requestId });
  });
  $("onlineLeave").addEventListener("click", () => {
    if (roomCode && connected) send({ type: "leave" });
    toMenu();
  });
  $("onlineCode").addEventListener("input", (event) => {
    event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  });
  document.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
      keys.add(key);
      if (active) event.preventDefault();
    }
  });
  document.addEventListener("keyup", (event) => keys.delete(event.key.toLowerCase()));
  canvas.addEventListener("pointerdown", (event) => {
    if (!active || document.getElementById("touchControls").classList.contains("active")) return;
    const bounds = canvas.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    pointer = { id: event.pointerId, x0: x, y0: event.clientY - bounds.top, x, y: event.clientY - bounds.top };
    try { canvas.setPointerCapture(event.pointerId); } catch (_) {}
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const bounds = canvas.getBoundingClientRect();
    pointer.x = event.clientX - bounds.left;
    pointer.y = event.clientY - bounds.top;
    const dx = pointer.x - pointer.x0;
    const dy = pointer.y - pointer.y0;
    if (pointer.x0 < bounds.width / 2) setMove(Math.max(-1, Math.min(1, dx / 50)), Math.max(-1, Math.min(1, dy / 50)));
  });
  const releasePointer = (event) => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const dx = pointer.x - pointer.x0;
    const dy = pointer.y - pointer.y0;
    if (pointer.x0 >= canvas.clientWidth / 2) hit(dx / Math.max(canvas.clientWidth * 0.28, 1), dy / Math.max(canvas.clientHeight * 0.28, 1));
    setMove(0, 0);
    pointer = null;
  };
  canvas.addEventListener("pointerup", releasePointer);
  canvas.addEventListener("pointercancel", releasePointer);
})();

"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { WebSocketServer, WebSocket } = require("ws");

const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = Number(process.env.PORT) || 3000;
const GRAVITY = 32;
const TICK = 1 / 30;
const BROADCAST_EVERY = 1;
const SKILL_HIT_BUFFER_MS = 4000;
const SKILL_COOLDOWNS = { drive: 8, drop: 10, curve: 8 };
const CHARACTERS = [
  { name: "Mango", speed: 1, reach: 3.6 },
  { name: "Zippy", speed: 1.22, reach: 3.1 },
  { name: "Bruno", speed: 0.85, reach: 4.2 },
  { name: "Luna", speed: 1.1, reach: 3.3 },
];
const rooms = new Map();
const clients = new Set();
let nextRequestId = 1;
const MIME = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".ttf": "font/ttf",
};
const PUBLIC_FILES = new Set([
  "index.html",
  "css/styles.css",
  "js/game.js",
  "js/online.js",
  "assets/fonts/plex-sans.ttf",
  "assets/fonts/OFL.txt",
]);

function send(socket, value) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
}
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
function cleanName(value) {
  const name = String(value || "Player").replace(/[<>\u0000-\u001f]/g, "").trim();
  return (name || "Player").slice(0, 8);
}
function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[crypto.randomInt(chars.length)];
  return code;
}
function roomCode() {
  let code;
  do code = makeCode(); while (rooms.has(code));
  return code;
}
function player(slot, client, gameType) {
  const isDoubles = gameType === "doubles";
  const team = isDoubles ? Math.floor(slot / 2) : slot;
  return {
    slot,
    name: client.name,
    characterName: client.characterName,
    characterId: client.characterId,
    character: CHARACTERS[client.characterId],
    client,
    socket: client.socket,
    x: team === 0 ? 5 + (slot % 2) * 10 : 15 - (slot % 2) * 10,
    y: team === 0 ? 3 + (slot % 2) * 5 : 41 - (slot % 2) * 5,
    skillReadyAt: { drive: 0, drop: 0, curve: 0 },
    pendingSkillHit: null,
    input: { x: 0, y: 0, ax: 0, ay: -0.5, hit: false, skill: null },
  };
}
function teamOf(room, slot) {
  return room.gameType === "doubles" ? Math.floor(slot / 2) : slot;
}
function teamSlot(room, team, member = 0) {
  return room.gameType === "doubles" ? team * 2 + member : team;
}
function matchState() {
  return {
    phase: "serve",
    score: [0, 0],
    serverTeam: 0,
    serverSlot: 0,
    serverNumber: 1,
    shots: 0,
    lastHitter: null,
    lastTeam: null,
    bounces: 0,
    serveBox: [0, 10],
    pointTimer: 0,
    message: "",
    paused: false,
    pausedAt: 0,
    ball: { x: 5, y: 3, z: 2.5, vx: 0, vy: 0, vz: 0, curve: 0, curveTime: 0 },
  };
}
function createRoom(client, gameType, scoring, visibility) {
  const code = roomCode();
  const maxPlayers = gameType === "doubles" ? 4 : 2;
  const room = {
    code,
    createdAt: Date.now(),
    status: "waiting",
    gameType,
    scoring,
    visibility,
    maxPlayers,
    host: client,
    players: Array(maxPlayers).fill(null),
    pendingRequests: new Map(),
    game: null,
  };
  room.players[0] = player(0, client, gameType);
  rooms.set(code, room);
  client.room = room;
  client.slot = 0;
  sendRoom(room);
  sendPublicRooms();
}
function sendRoom(room) {
  room.players.forEach((entry) => {
    if (entry) send(entry.socket, {
      type: "room",
      code: room.code,
      slot: entry.slot,
      status: room.status,
      gameType: room.gameType,
      scoring: room.scoring,
      visibility: room.visibility,
      maxPlayers: room.maxPlayers,
      hostSlot: 0,
      players: room.players.map((p) => p && ({
        name: p.name,
        characterName: p.characterName,
        characterId: p.characterId,
      })),
      pendingRequests: entry.client === room.host
        ? Array.from(room.pendingRequests, ([id, request]) => ({ id, name: request.client.name }))
        : [],
    });
  });
}
function sendPublicRooms() {
  const publicRooms = Array.from(rooms.values())
    .filter((room) => room.visibility === "public" && room.status === "waiting" && room.players.some((entry) => !entry))
    .map((room) => ({
      code: room.code,
      gameType: room.gameType,
      scoring: room.scoring,
      players: room.players.filter(Boolean).length,
      maxPlayers: room.maxPlayers,
    }));
  clients.forEach((client) => send(client.socket, { type: "public-rooms", rooms: publicRooms }));
}
function startMatch(room) {
  room.pendingRequests.forEach((request) => {
    send(request.client.socket, { type: "join-declined", message: "The match started before your request was accepted." });
    request.client.requestedRoom = null;
  });
  room.pendingRequests.clear();
  room.status = "playing";
  room.game = matchState();
  room.game.scoring = room.scoring;
  room.game.serverNumber = room.gameType === "doubles" && room.scoring === "official" ? 2 : 1;
  setServe(room);
  sendRoom(room);
  broadcastState(room);
  sendPublicRooms();
}
function setServe(room) {
  const game = room.game;
  game.phase = "serve";
  game.shots = 0;
  game.lastHitter = null;
  game.lastTeam = null;
  game.bounces = 0;
  game.pointTimer = 0;
  game.message = "";
  const serverTeam = game.serverTeam;
  const even = game.score[serverTeam] % 2 === 0;
  const serverX = serverTeam === 1 ? (even ? 15 : 5) : (even ? 5 : 15);
  game.serverSlot = teamSlot(room, serverTeam, room.gameType === "doubles" ? game.serverSlot % 2 : 0);
  const server = room.players[game.serverSlot];
  const receiverTeam = 1 - serverTeam;
  const receiverSlot = teamSlot(room, receiverTeam, room.gameType === "doubles" ? game.score[receiverTeam] % 2 : 0);
  const receiver = room.players[receiverSlot];
  server.x = serverX;
  server.y = serverTeam === 0 ? 3 : 41;
  receiver.x = 20 - serverX;
  receiver.y = serverTeam === 0 ? 41 : 3;
  if (room.gameType === "doubles") {
    const serverPartner = room.players[teamSlot(room, serverTeam, 1 - (game.serverSlot % 2))];
    const receiverPartner = room.players[teamSlot(room, receiverTeam, 1 - (receiverSlot % 2))];
    serverPartner.x = 20 - serverX;
    serverPartner.y = serverTeam === 0 ? 8 : 36;
    receiverPartner.x = serverX;
    receiverPartner.y = serverTeam === 0 ? 36 : 8;
  }
  game.serveBox = serverX < 10 ? [10, 20] : [0, 10];
  game.ball = { x: server.x, y: server.y, z: 2.5, vx: 0, vy: 0, vz: 0, curve: 0, curveTime: 0 };
}
function snapshot(room, slot) {
  const game = room.game;
  return {
    type: "state",
    code: room.code,
    slot,
    status: room.status,
    gameType: room.gameType,
    scoring: room.scoring,
    players: room.players.map((p) => p && ({
      name: p.name,
      characterName: p.characterName,
      characterId: p.characterId,
      x: p.x,
      y: p.y,
      skillCooldowns: Object.fromEntries(
        Object.entries(p.skillReadyAt).map(([skill, readyAt]) => [
          skill,
          Math.max(0, (readyAt - Date.now()) / 1000),
        ]),
      ),
    })),
    game: game && {
      phase: game.phase,
      score: game.score,
      serverTeam: game.serverTeam,
      serverSlot: game.serverSlot,
      serverNumber: game.serverNumber,
      shots: game.shots,
      lastHitter: game.lastHitter,
      lastTeam: game.lastTeam,
      bounces: game.bounces,
      message: game.message,
      paused: game.paused,
      ball: game.ball,
    },
  };
}
function broadcastState(room) {
  room.players.forEach((entry) => {
    if (entry) send(entry.socket, snapshot(room, entry.slot));
  });
}
function finishRoom(room, winner, reason) {
  const score = room.game ? room.game.score : [0, 0];
  room.status = "ended";
  room.players.forEach((entry) => {
    if (entry) {
      send(entry.socket, {
        type: "ended",
        winner,
        youWon: teamOf(room, entry.slot) === winner,
        gameType: room.gameType,
        reason,
        score,
      });
      entry.client.room = null;
      entry.client.slot = null;
    }
  });
  rooms.delete(room.code);
  sendPublicRooms();
}
function point(room, winner, reason) {
  const game = room.game;
  if (!game || game.phase !== "rally") return;
  const isDoubles = room.gameType === "doubles";
  if (room.scoring === "rally") {
    game.score[winner]++;
    game.serverTeam = winner;
    game.serverSlot = teamSlot(room, winner, isDoubles ? game.score[winner] % 2 : 0);
    game.serverNumber = 1;
  } else if (winner === game.serverTeam) {
    game.score[winner]++;
  } else if (isDoubles && game.serverNumber === 1) {
    game.serverNumber = 2;
    game.serverSlot = teamSlot(room, game.serverTeam, 1 - (game.serverSlot % 2));
  } else {
    game.serverTeam = winner;
    game.serverSlot = teamSlot(room, winner, 0);
    game.serverNumber = 1;
  }
  game.message = reason;
  const [a, b] = game.score;
  if (game.score[winner] >= 11 && Math.abs(a - b) >= 2) {
    finishRoom(room, winner, reason);
    return;
  }
  game.phase = "point";
  game.pointTimer = 1.15;
}
function hitBall(room, slot, requestedSkill) {
  const game = room.game;
  const hitter = room.players[slot];
  const hitterTeam = teamOf(room, slot);
  const ball = game.ball;
  if (game.phase === "serve") {
    if (slot !== game.serverSlot) return;
  } else {
    if (game.phase !== "rally" || hitterTeam === game.lastTeam) return;
    if (game.shots < 3 && game.bounces === 0) {
      point(room, 1 - hitterTeam, "Hit before the bounce");
      return;
    }
    if (game.bounces === 0 && Math.abs(hitter.y - 22) <= 7) {
      point(room, 1 - hitterTeam, "Volley in kitchen");
      return;
    }
    if (Math.hypot(hitter.x - ball.x, hitter.y - ball.y) > hitter.character.reach || ball.z > 5.5) return;
  }

  const aimX = clamp(hitter.input.ax, -1, 1);
  const aimY = clamp(hitter.input.ay, -1, 1);
  const canUseSkill = Object.hasOwn(SKILL_COOLDOWNS, requestedSkill) &&
    Date.now() >= hitter.skillReadyAt[requestedSkill] &&
    (requestedSkill !== "drop" || game.phase === "rally");
  let targetX;
  let targetY;
  if (game.phase === "serve") {
    const left = hitter.x < 10;
    const boxMin = left ? 10 : 0;
    const boxMax = left ? 20 : 10;
    targetX = clamp((boxMin + boxMax) / 2 + aimX * 3.5, boxMin + 0.6, boxMax - 0.6);
    targetY = hitterTeam === 0 ? 34 : 10;
  } else {
    targetX = clamp(10 + aimX * 8 + (ball.x - hitter.x) * 0.45, 0.5, 19.5);
    const opponentCenter = hitterTeam === 0 ? 33 : 11;
    const forwardSign = hitterTeam === 0 ? 1 : -1;
    targetY = clamp(opponentCenter - aimY * forwardSign * 9, hitterTeam === 0 ? 23 : 0, hitterTeam === 0 ? 44 : 21);
  }
  if (canUseSkill && requestedSkill === "drop") targetY = hitterTeam === 0 ? 26 : 18;
  if (canUseSkill && requestedSkill === "drive") {
    targetX += (Math.random() - 0.5) * 2.8;
    targetY += (Math.random() - 0.5) * 1.8;
  }
  const distance = Math.hypot(targetX - ball.x, targetY - ball.y);
  const baseTime = clamp(distance / 26, game.phase === "serve" ? 1.15 : 0.75, 1.5);
  const time = canUseSkill && requestedSkill === "drive"
    ? Math.max(0.52, baseTime * 0.72)
    : canUseSkill && requestedSkill === "drop"
      ? Math.min(1.7, baseTime * 1.2)
      : baseTime;
  const curve = canUseSkill && requestedSkill === "curve"
    ? (Math.sign(targetX - ball.x) || (hitterTeam === 0 ? 1 : -1)) * 6
    : 0;
  if (curve) {
    const curveDuration = Math.min(0.65, time);
    const curveDrift = curve * (curveDuration * time - curveDuration * curveDuration / 2);
    targetX = clamp(targetX - curveDrift, 0.5, 19.5);
  }
  ball.x = hitter.x;
  ball.y = hitter.y;
  ball.z = 2.5;
  ball.vx = (targetX - ball.x) / time;
  ball.vy = (targetY - ball.y) / time;
  ball.vz = (GRAVITY * time * time / 2 - ball.z) / time;
  ball.curve = curve;
  ball.curveTime = ball.curve ? 0.65 : 0;
  if (canUseSkill) hitter.skillReadyAt[requestedSkill] = Date.now() + SKILL_COOLDOWNS[requestedSkill] * 1000;
  game.shots++;
  game.lastHitter = slot;
  game.lastTeam = hitterTeam;
  game.bounces = 0;
  game.phase = "rally";
}
function canUseBufferedSkill(room, slot) {
  const game = room.game;
  const hitter = room.players[slot];
  const ball = game.ball;
  if (game.phase === "serve") return slot === game.serverSlot;
  if (game.phase !== "rally" || teamOf(room, slot) === game.lastTeam) return false;
  if (game.bounces === 0 && (game.shots < 3 || Math.abs(hitter.y - 22) <= 7)) return false;
  return Math.hypot(hitter.x - ball.x, hitter.y - ball.y) <= hitter.character.reach && ball.z <= 5.5;
}
function land(room) {
  const game = room.game;
  const ball = game.ball;
  const last = game.lastTeam;
  const radius = 0.5;
  if (ball.x < -radius || ball.x > 20 + radius || ball.y < -radius || ball.y > 44 + radius) {
    point(room, 1 - last, "Ball out");
    return;
  }
  const side = ball.y < 22 ? 0 : 1;
  if (game.shots === 1) {
    const [minX, maxX] = game.serveBox;
    const serveFault = side !== 1 - game.serverTeam ||
      ball.x < minX - radius || ball.x > maxX + radius ||
      Math.abs(ball.y - 22) <= 7 + radius;
    if (serveFault) {
      point(room, 1 - game.serverTeam, "Serve fault");
      return;
    }
  }
  if (side === last) {
    point(room, 1 - last, "Ball stayed on hitter's side");
    return;
  }
  if (game.bounces >= 1) {
    point(room, last, "Double bounce");
    return;
  }
  game.bounces++;
}
function advance(room, dt) {
  if (room.status !== "playing" || !room.game) return;
  const game = room.game;
  if (game.phase === "ended" || game.paused) return;
  if (game.phase === "point") {
    game.pointTimer -= dt;
    if (game.pointTimer <= 0) setServe(room);
    return;
  }

  room.players.forEach((entry) => {
    const input = entry.input;
    const team = teamOf(room, entry.slot);
    const orientation = team === 0 ? -1 : 1;
    entry.x = clamp(entry.x + input.x * orientation * 14 * entry.character.speed * dt, 0.3, 19.7);
    entry.y = clamp(entry.y + input.y * orientation * 14 * entry.character.speed * dt,
      team === 0 ? 0.5 : 22.5,
      team === 0 ? 21.5 : 43.5);
    if (input.hit) {
      input.hit = false;
      const skill = input.skill;
      input.skill = null;
      if (skill) {
        entry.pendingSkillHit = {
          skill,
          expiresAt: Date.now() + SKILL_HIT_BUFFER_MS,
        };
      } else {
        hitBall(room, entry.slot, null);
      }
    }
  });
  room.players.forEach((entry) => {
    const pending = entry.pendingSkillHit;
    if (!pending) return;
    if (Date.now() >= pending.expiresAt || Date.now() < entry.skillReadyAt[pending.skill]) {
      entry.pendingSkillHit = null;
      return;
    }
    if (pending.skill === "drop" && game.phase !== "rally") return;
    if (!canUseBufferedSkill(room, entry.slot)) return;
    entry.pendingSkillHit = null;
    hitBall(room, entry.slot, pending.skill);
  });

  if (game.phase === "serve") {
    const server = room.players[game.serverSlot];
    game.ball.x = server.x;
    game.ball.y = server.y;
    game.ball.z = 2.5;
    game.ball.vx = game.ball.vy = game.ball.vz = 0;
    return;
  }

  const ball = game.ball;
  const oldY = ball.y;
  const oldZ = ball.z;
  const oldVz = ball.vz;
  if (ball.curveTime > 0) {
    ball.vx += ball.curve * dt;
    ball.curveTime = Math.max(0, ball.curveTime - dt);
    if (ball.curveTime === 0) ball.curve = 0;
  }
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  ball.vz -= GRAVITY * dt;
  ball.z += ball.vz * dt;
  if ((oldY - 22) * (ball.y - 22) <= 0 && oldY !== ball.y) {
    const fraction = (22 - oldY) / (ball.y - oldY);
    const timeToNet = dt * fraction;
    const zAtNet = oldZ + oldVz * timeToNet - GRAVITY * timeToNet * timeToNet / 2;
    if (zAtNet < 0.9) {
      point(room, 1 - game.lastTeam, "Hit the net");
      return;
    }
  }
  if (ball.z <= 0 && ball.vz < 0) {
    ball.z = 0;
    land(room);
    if (game.phase !== "rally") return;
    ball.vz = -ball.vz * 0.68;
    ball.vx *= 0.82;
    ball.vy *= 0.82;
    ball.curve = 0;
    ball.curveTime = 0;
  }
}
function leaveRoom(client, reason) {
  if (client.requestedRoom) {
    const requestedRoom = client.requestedRoom;
    for (const [id, request] of requestedRoom.pendingRequests) {
      if (request.client !== client) continue;
      requestedRoom.pendingRequests.delete(id);
      send(requestedRoom.host.socket, { type: "join-request-cancelled", id });
      sendRoom(requestedRoom);
      break;
    }
    client.requestedRoom = null;
  }
  const room = client.room;
  if (!room) return;
  if (room.status === "playing") {
    finishRoom(room, 1 - teamOf(room, client.slot), reason || "Opponent left");
    return;
  }
  if (client === room.host) {
    rooms.delete(room.code);
    room.players.forEach((entry) => {
      if (!entry || entry.client === client) return;
      send(entry.socket, { type: "room-left", reason: reason || "Host closed the room." });
      entry.client.room = null;
      entry.client.slot = null;
    });
    room.pendingRequests.forEach((request) => {
      send(request.client.socket, { type: "join-declined", message: "The room host closed the room." });
      request.client.requestedRoom = null;
    });
  } else {
    room.players[client.slot] = null;
    client.room = null;
    client.slot = null;
    sendRoom(room);
  }
  client.room = null;
  client.slot = null;
  sendPublicRooms();
}
function assignPlayer(room, client, slot) {
  const entry = player(slot, client, room.gameType);
  room.players[slot] = entry;
  client.room = room;
  client.slot = slot;
  client.requestedRoom = null;
  sendRoom(room);
  if (room.players.every(Boolean) &&
      (room.visibility === "public" || room.gameType === "singles")) {
    startMatch(room);
  } else {
    sendPublicRooms();
  }
}
function joinRoom(client, code) {
  const now = Date.now();
  client.joinAttempts = (client.joinAttempts || []).filter((time) => now - time < 60000);
  if (client.joinAttempts.length >= 12)
    return send(client.socket, { type: "error", message: "Too many room-code attempts. Wait a minute and try again." });
  client.joinAttempts.push(now);
  if (client.room || client.requestedRoom)
    return send(client.socket, { type: "error", message: "Leave your current room or pending request first." });
  const room = rooms.get(String(code || "").toUpperCase());
  if (!room || room.status !== "waiting")
    return send(client.socket, { type: "error", message: "That room code is unavailable." });
  const slot = room.players.findIndex((entry) => !entry);
  if (slot < 0)
    return send(client.socket, { type: "error", message: "That room is full." });
  if (room.visibility === "private") {
    if (room.pendingRequests.size >= room.maxPlayers * 2)
      return send(client.socket, { type: "error", message: "The host has too many join requests waiting." });
    const id = nextRequestId++;
    room.pendingRequests.set(id, { id, client });
    client.requestedRoom = room;
    send(room.host.socket, { type: "join-request", id, name: client.name, gameType: room.gameType });
    send(client.socket, { type: "join-pending", code: room.code });
    sendRoom(room);
    return;
  }
  assignPlayer(room, client, slot);
}
function receive(client, message) {
  if (message.type === "hello") {
    client.name = cleanName(message.name);
    if (!client.room || client.room.status !== "playing") {
      const characterId = Number(message.characterId);
      const namedCharacterId = CHARACTERS.findIndex(
        (character) => character.name.toLowerCase() === cleanName(message.characterName).toLowerCase(),
      );
      client.characterId = Number.isInteger(characterId) && characterId >= 0 && characterId < CHARACTERS.length
        ? characterId
        : namedCharacterId >= 0 ? namedCharacterId : 0;
    }
    client.characterName = CHARACTERS[client.characterId].name;
    if (client.room && client.room.players[client.slot]) {
      client.room.players[client.slot].name = client.name;
      client.room.players[client.slot].characterName = client.characterName;
      client.room.players[client.slot].characterId = client.characterId;
      client.room.players[client.slot].character = CHARACTERS[client.characterId];
      if (client.room.status === "playing") broadcastState(client.room);
      else sendRoom(client.room);
    }
    if (client.requestedRoom) sendRoom(client.requestedRoom);
    send(client.socket, { type: "welcome", name: client.name });
    sendPublicRooms();
    return;
  }
  if (message.type === "create") {
    if (client.room || client.requestedRoom)
      return send(client.socket, { type: "error", message: "Leave your current room or pending request first." });
    const gameType = message.gameType;
    const scoring = message.scoring;
    const visibility = message.visibility;
    if (!["singles", "doubles"].includes(gameType) ||
        !["rally", "official"].includes(scoring) ||
        !["public", "private"].includes(visibility))
      return send(client.socket, { type: "error", message: "Choose a game type, scoring rule, and room visibility." });
    if (rooms.size >= 300) return send(client.socket, { type: "error", message: "Server is full. Try again later." });
    createRoom(client, gameType, scoring, visibility);
    return;
  }
  if (message.type === "join") {
    joinRoom(client, message.code);
    return;
  }
  if (message.type === "list-rooms") {
    sendPublicRooms();
    return;
  }
  if (message.type === "start") {
    const room = client.room;
    if (!room || client !== room.host || room.status !== "waiting" ||
        room.visibility !== "private" || room.gameType !== "doubles")
      return send(client.socket, { type: "error", message: "Only the host can start a private 2v2 room." });
    if (!room.players.every(Boolean))
      return send(client.socket, { type: "error", message: "All four player seats must be filled before starting." });
    startMatch(room);
    return;
  }
  if (message.type === "accept" || message.type === "decline") {
    const room = client.room;
    if (!room || client !== room.host || room.status !== "waiting")
      return send(client.socket, { type: "error", message: "Only the host can manage requests in a waiting room." });
    const id = Number(message.id);
    const request = room.pendingRequests.get(id);
    if (!request) return;
    room.pendingRequests.delete(id);
    if (message.type === "decline") {
      request.client.requestedRoom = null;
      send(request.client.socket, { type: "join-declined", message: "The host declined your request." });
      sendRoom(room);
      return;
    }
    const slot = room.players.findIndex((entry) => !entry);
    if (request.client.socket.readyState !== WebSocket.OPEN || request.client.requestedRoom !== room || slot < 0) {
      request.client.requestedRoom = null;
      send(request.client.socket, { type: "join-declined", message: "The room is no longer available." });
      sendRoom(room);
      return;
    }
    assignPlayer(room, request.client, slot);
    return;
  }
  if (message.type === "leave") {
    leaveRoom(client, "Player left the match.");
    return;
  }
  if ((message.type === "pause" || message.type === "resume") &&
      client.room && client.room.status === "playing" && client.room.game) {
    const game = client.room.game;
    if (message.type === "pause" && !game.paused) {
      game.paused = true;
      game.pausedAt = Date.now();
      client.room.players.forEach((entry) => {
        if (entry) {
          entry.input.x = 0;
          entry.input.y = 0;
          entry.input.hit = false;
          entry.input.skill = null;
        }
      });
    } else if (message.type === "resume" && game.paused) {
      const pausedFor = Date.now() - game.pausedAt;
      client.room.players.forEach((entry) => {
        if (!entry) return;
        Object.keys(entry.skillReadyAt).forEach((skill) => {
          if (entry.skillReadyAt[skill] > 0) entry.skillReadyAt[skill] += pausedFor;
        });
        if (entry.pendingSkillHit) entry.pendingSkillHit.expiresAt += pausedFor;
      });
      game.paused = false;
      game.pausedAt = 0;
    }
    broadcastState(client.room);
    return;
  }
  if (message.type === "input" && client.room && client.room.status === "playing" &&
      !client.room.game.paused) {
    const input = client.room.players[client.slot].input;
    input.x = clamp(Number(message.x) || 0, -1, 1);
    input.y = clamp(Number(message.y) || 0, -1, 1);
    input.ax = clamp(Number(message.ax) || 0, -1, 1);
    input.ay = clamp(Number(message.ay) || 0, -1, 1);
    if (message.hit) {
      input.hit = true;
      input.skill = typeof message.skill === "string" && Object.hasOwn(SKILL_COOLDOWNS, message.skill)
        ? message.skill
        : null;
    }
  }
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname === "/health") {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end("Method not allowed");
    return;
  }
  let filePath;
  try {
    const requested = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const fileName = requested || "index.html";
    if (!PUBLIC_FILES.has(fileName)) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    filePath = path.join(PUBLIC_DIR, fileName);
  } catch (_) {
    response.writeHead(400);
    response.end("Bad request");
    return;
  }
  fs.stat(filePath, (error, info) => {
    if (error || !info.isFile()) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      "content-type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "content-length": info.size,
      "x-content-type-options": "nosniff",
      "cache-control": [".html", ".js", ".css"].includes(path.extname(filePath).toLowerCase())
        ? "no-cache"
        : "public, max-age=3600",
    });
    if (request.method === "HEAD") response.end();
    else fs.createReadStream(filePath).pipe(response);
  });
});
const webSockets = new WebSocketServer({
  server,
  path: "/online",
  maxPayload: 8192,
  verifyClient: ({ origin, req }, callback) => {
    if (!origin || origin === "null") return callback(true);
    try {
      callback(new URL(origin).host === req.headers.host, 403, "Origin not allowed");
    } catch (_) {
      callback(false, 403, "Origin not allowed");
    }
  },
});
webSockets.on("connection", (socket) => {
  if (clients.size >= 300) {
    socket.close(1013, "Server is full");
    return;
  }
  const client = { socket, name: "Player", characterId: 0, characterName: CHARACTERS[0].name, room: null, slot: null };
  clients.add(client);
  send(socket, { type: "connected" });
  socket.on("message", (raw) => {
    const now = Date.now();
    if (!client.rateAt || now - client.rateAt >= 1000) {
      client.rateAt = now;
      client.rateCount = 0;
    }
    client.rateCount++;
    if (client.rateCount > 100) {
      socket.close(1008, "Too many messages");
      return;
    }
    try {
      const message = JSON.parse(raw.toString());
      if (!message || typeof message.type !== "string") return;
      receive(client, message);
    } catch (_) {
      send(socket, { type: "error", message: "Invalid message." });
    }
  });
  socket.on("close", () => {
    leaveRoom(client, "Opponent disconnected");
    clients.delete(client);
    sendPublicRooms();
  });
  socket.on("error", () => {});
});

let tick = 0;
setInterval(() => {
  for (const room of rooms.values()) {
    if (room.status === "waiting" && Date.now() - room.createdAt > 5 * 60 * 1000) {
      room.players.forEach((entry) => {
        if (entry) {
          send(entry.socket, { type: "room-left", reason: "Room expired. Create a new one." });
          entry.client.room = null;
          entry.client.slot = null;
        }
      });
      room.pendingRequests.forEach((request) => {
        send(request.client.socket, { type: "join-declined", message: "Room expired. Create or join another room." });
        request.client.requestedRoom = null;
      });
      rooms.delete(room.code);
      sendPublicRooms();
      continue;
    }
    advance(room, TICK);
  }
  tick++;
  if (tick % BROADCAST_EVERY === 0)
    for (const room of rooms.values()) if (room.status === "playing") broadcastState(room);
}, TICK * 1000);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Court Clash server listening on ${PORT}`);
});

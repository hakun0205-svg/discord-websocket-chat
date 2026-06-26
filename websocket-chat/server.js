const http = require("http");
const WebSocket = require("ws");

const port = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("WebSocket chat server is running");
});

const wss = new WebSocket.Server({ server });
const clients = new Map();
const messageStore = new Map();
const channels = new Set(["general", "開発", "雑談"]);
const users = new Map();

function createId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getChannelMessages(channel) {
  if (!messageStore.has(channel)) {
    messageStore.set(channel, []);
  }
  return messageStore.get(channel);
}

function broadcast(payload, channel) {
  const packet = JSON.stringify(payload);
  clients.forEach((client) => {
    if (client.ws.readyState === WebSocket.OPEN && (!channel || client.channel === channel)) {
      client.ws.send(packet);
    }
  });
}

function broadcastUsers(channel) {
  const users = [...clients.values()].filter((client) => client.channel === channel).map((client) => client.name).filter(Boolean);
  const packet = JSON.stringify({ type: "users", channel, users });
  clients.forEach((client) => {
    if (client.ws.readyState === WebSocket.OPEN && (!channel || client.channel === channel)) {
      client.ws.send(packet);
    }
  });
}

function broadcastChannels() {
  const packet = JSON.stringify({ type: "channels", channels: [...channels] });
  clients.forEach((client) => {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(packet);
    }
  });
}

function normalizeChannelName(value) {
  return (value || "").trim().replace(/^#+/, "").replace(/\s+/g, "-");
}

function authenticateUser(name, password) {
  if (!name || !password) {
    return false;
  }
  const existing = users.get(name);
  if (existing && existing.password !== password) {
    return false;
  }
  if (!existing) {
    users.set(name, { password, name, role: "user" });
  }
  return true;
}

function getAdminUsersPayload() {
  return {
    type: "adminUsers",
    users: [...users.values()].map((entry) => ({ name: entry.name, role: entry.role || "user" })),
  };
}

function broadcastAdminUsers() {
  const packet = JSON.stringify(getAdminUsersPayload());
  clients.forEach((client) => {
    if (client.ws.readyState === WebSocket.OPEN && client.isAdmin) {
      client.ws.send(packet);
    }
  });
}

wss.on("connection", (ws) => {
  clients.set(ws, { ws, name: "Guest", channel: "general" });
  broadcastChannels();
  broadcastUsers("general");
  ws.send(JSON.stringify({ type: "channels", channels: [...channels] }));
  ws.send(JSON.stringify({ type: "history", channel: "general", messages: getChannelMessages("general") }));

  ws.on("message", (data) => {
    let payload;
    try {
      payload = JSON.parse(data.toString());
    } catch (error) {
      return;
    }

    if (!payload) {
      return;
    }

    const client = clients.get(ws);
    if (!client) {
      return;
    }

    if (payload.type === "login") {
      const name = (payload.user || "Guest").trim();
      const password = (payload.password || "").trim();
      const isAdminLogin = name === "admin" && password === "admin123";
      if (!isAdminLogin && !authenticateUser(name, password)) {
        ws.send(JSON.stringify({ type: "authError", message: "ユーザー名またはパスワードが違います" }));
        return;
      }
      if (!users.has(name)) {
        users.set(name, { password, name, role: isAdminLogin ? "admin" : "user" });
      } else if (isAdminLogin) {
        users.set(name, { ...users.get(name), password, role: "admin" });
      }
      client.name = name;
      client.role = isAdminLogin ? "admin" : (users.get(name)?.role || "user");
      client.isAdmin = client.role === "admin";
      client.channel = payload.channel || client.channel || "general";
      if (!channels.has(client.channel)) {
        channels.add(client.channel);
      }
      broadcastChannels();
      broadcastUsers(client.channel);
      ws.send(JSON.stringify({ type: "loginSuccess", admin: client.isAdmin }));
      ws.send(JSON.stringify({ type: "history", channel: client.channel, messages: getChannelMessages(client.channel) }));
      broadcastAdminUsers();
      broadcast({ type: "system", id: createId(), text: `${client.name} が参加しました。`, channel: client.channel }, client.channel);
      return;
    }

    if (payload.type === "createChannel") {
      const name = normalizeChannelName(payload.channel);
      if (!name || channels.has(name)) {
        return;
      }
      channels.add(name);
      broadcastChannels();
      return;
    }

    if (payload.type === "deleteChannel") {
      const name = normalizeChannelName(payload.channel);
      if (!name || name === "general" || !channels.has(name)) {
        return;
      }
      channels.delete(name);
      messageStore.delete(name);
      clients.forEach((entry) => {
        if (entry.channel === name) {
          entry.channel = "general";
          entry.ws.send(JSON.stringify({ type: "history", channel: "general", messages: getChannelMessages("general") }));
        }
      });
      broadcastChannels();
      broadcastUsers("general");
      return;
    }

    if (payload.type === "getAdminUsers") {
      if (!client.isAdmin) {
        return;
      }
      ws.send(JSON.stringify(getAdminUsersPayload()));
      return;
    }

    if (payload.type === "deleteUser") {
      if (!client.isAdmin) {
        return;
      }
      const targetName = (payload.username || "").trim();
      if (!targetName || targetName === client.name) {
        return;
      }
      users.delete(targetName);
      clients.forEach((entry) => {
        if (entry.name === targetName) {
          entry.ws.send(JSON.stringify({ type: "authError", message: "管理者により削除されました" }));
          entry.ws.close();
        }
      });
      broadcastAdminUsers();
      return;
    }

    if (payload.type === "switchChannel") {
      const previousChannel = client.channel;
      client.channel = payload.channel || "general";
      if (previousChannel !== client.channel) {
        broadcastUsers(previousChannel);
      }
      broadcastUsers(client.channel);
      ws.send(JSON.stringify({ type: "history", channel: client.channel, messages: getChannelMessages(client.channel) }));
      return;
    }

    if (payload.type === "message" || payload.type === "image") {
      const channel = payload.channel || client.channel || "general";
      if (!channels.has(channel)) {
        channels.add(channel);
      }
      const message = {
        id: payload.id || createId(),
        type: payload.type,
        user: payload.user || client.name || "Guest",
        text: payload.text || "",
        image: payload.image || null,
        time: payload.time || new Date().toISOString(),
        replyTo: payload.replyTo || null,
        pinned: false,
        channel,
      };
      getChannelMessages(channel).push(message);
      broadcast(message, channel);
      return;
    }

    if (payload.type === "typing") {
      const channel = payload.channel || client.channel || "general";
      broadcast({ type: "typing", user: payload.user || client.name || "Guest", channel }, channel);
      return;
    }

    if (payload.type === "pin") {
      const channel = payload.channel || client.channel || "general";
      const target = getChannelMessages(channel).find((item) => item.id === payload.id);
      if (!target) {
        return;
      }
      target.pinned = !target.pinned;
      broadcast({ type: "pin", id: target.id, pinned: target.pinned, channel }, channel);
      return;
    }

    if (payload.type === "edit") {
      const channel = payload.channel || client.channel || "general";
      const target = getChannelMessages(channel).find((item) => item.id === payload.id);
      if (!target || target.user !== (payload.user || client.name)) {
        return;
      }
      target.text = payload.text || "";
      target.time = payload.time || new Date().toISOString();
      broadcast({ type: "edit", id: target.id, text: target.text, time: target.time, channel }, channel);
      return;
    }

    if (payload.type === "delete") {
      const channel = payload.channel || client.channel || "general";
      const targetIndex = getChannelMessages(channel).findIndex((item) => item.id === payload.id);
      if (targetIndex < 0) {
        return;
      }
      const target = getChannelMessages(channel)[targetIndex];
      if (target.user !== (payload.user || client.name)) {
        return;
      }
      getChannelMessages(channel).splice(targetIndex, 1);
      broadcast({ type: "delete", id: payload.id, channel }, channel);
    }
  });

  ws.on("close", () => {
    const client = clients.get(ws);
    if (client) {
      const name = client.name;
      const channel = client.channel;
      clients.delete(ws);
      broadcastUsers(channel);
      if (name) {
        broadcast({ type: "system", id: createId(), text: `${name} が退出しました。`, channel }, channel);
      }
    }
  });
});

server.listen(port, () => {
  console.log(`WebSocket server listening on ws://localhost:${port}`);
});

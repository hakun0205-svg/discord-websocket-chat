const form = document.getElementById("chat-form");
const input = document.getElementById("message-input");
const imageInput = document.getElementById("image-input");
const emojiButtons = document.querySelectorAll(".emoji-btn");
const messages = document.getElementById("messages");
const usernameInput = document.getElementById("username");
const status = document.getElementById("status");
const connectButton = document.getElementById("connect-btn");
const logoutButton = document.getElementById("logout-btn");
const loginOverlay = document.getElementById("login-overlay");
const loginUsernameInput = document.getElementById("login-username");
const loginPasswordInput = document.getElementById("login-password");
const loginButton = document.getElementById("login-btn");
const userList = document.getElementById("user-list");
const adminPanel = document.getElementById("admin-panel");
const adminUserList = document.getElementById("admin-user-list");
const memberCount = document.getElementById("member-count");
const typingIndicator = document.getElementById("typing-indicator");
const pinnedMessagesContainer = document.getElementById("pinned-messages");
const channelList = document.getElementById("channel-list");
const newChannelInput = document.getElementById("new-channel-name");
const createChannelButton = document.getElementById("create-channel-btn");
const deleteChannelButton = document.getElementById("delete-channel-btn");
const channelTitle = document.getElementById("channel-title");
const searchInput = document.getElementById("message-search");
const themeToggleButton = document.getElementById("theme-toggle-btn");
const STORAGE_KEY = "discord-chat-messages";
const defaultMessages = [
  {
    id: "welcome-1",
    user: "Alice",
    text: "こんにちは！リアルタイムチャットに接続できます。",
    time: "2026-06-26T09:30:00",
    type: "message",
    channel: "general",
  },
  {
    id: "welcome-2",
    user: "Bob",
    text: "ニックネームを入れてから接続すると、他の人と区別しやすいです。",
    time: "2026-06-26T09:32:00",
    type: "message",
    channel: "general",
  },
];

let socket = null;
let connected = false;
let messageHistory = [];
let users = [];
let adminUsers = [];
let currentUser = "Guest";
let currentChannel = "general";
let authToken = null;
let isAdmin = false;
let channels = ["general", "開発", "雑談"];
let channelMessages = {};
let audioContext = null;
let typingTimer = null;
let replyMessage = null;
let searchQuery = "";
let isLightTheme = false;

function formatTime(timeValue = new Date()) {
  const value = new Date(timeValue);
  return value.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function createMessageId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeMessage(message, fallbackChannel = currentChannel) {
  return {
    id: message.id || createMessageId(),
    user: message.user || "Guest",
    text: message.text || "",
    time: message.time || new Date().toISOString(),
    type: message.type || "message",
    image: message.image || null,
    replyTo: message.replyTo || null,
    pinned: Boolean(message.pinned),
    channel: message.channel || fallbackChannel,
  };
}

function setStatus(label, isConnected) {
  status.textContent = label;
  status.className = `status ${isConnected ? "connected" : "disconnected"}`;
  connectButton.textContent = isConnected ? "切断" : "接続";
}

function normalizeChannelName(value) {
  return (value || "").trim().replace(/^#+/, "").replace(/\s+/g, "-");
}

function getChannelStorageKey(channel = currentChannel) {
  return `${STORAGE_KEY}:${channel}`;
}

function loadMessagesForChannel(channel = currentChannel) {
  try {
    const key = getChannelStorageKey(channel);
    const saved = JSON.parse(localStorage.getItem(key) || "[]");
    if (Array.isArray(saved) && saved.length > 0) {
      return saved.map((item) => normalizeMessage(item, channel));
    }
    return defaultMessages.filter((item) => item.channel === channel).map((item) => normalizeMessage(item, channel));
  } catch (error) {
    return defaultMessages.filter((item) => item.channel === channel).map((item) => normalizeMessage(item, channel));
  }
}

function saveMessages(channel = currentChannel) {
  const list = (channelMessages[channel] || []).slice(-100);
  channelMessages[channel] = list;
  localStorage.setItem(getChannelStorageKey(channel), JSON.stringify(list));
}

function scrollToBottom() {
  messages.scrollTop = messages.scrollHeight;
}

function matchesSearchQuery(message) {
  const query = searchQuery.trim().toLowerCase();
  if (!query) {
    return true;
  }
  const haystack = `${message.user || ""} ${message.text || ""}`.toLowerCase();
  return haystack.includes(query);
}

function getVisibleMessages() {
  return (messageHistory || []).filter((message) => matchesSearchQuery(message));
}

function applyTheme() {
  document.body.classList.toggle("light-theme", isLightTheme);
  if (themeToggleButton) {
    themeToggleButton.textContent = isLightTheme ? "☀️" : "🌙";
  }
}

function toggleTheme() {
  isLightTheme = !isLightTheme;
  localStorage.setItem("discord-chat-theme", isLightTheme ? "light" : "dark");
  applyTheme();
}

function renderPinnedMessages() {
  if (!pinnedMessagesContainer) return;
  const pinnedItems = getVisibleMessages().filter((item) => item.pinned && item.type !== "system");
  if (pinnedItems.length === 0) {
    pinnedMessagesContainer.innerHTML = "";
    return;
  }

  pinnedMessagesContainer.innerHTML = '<div class="pinned-messages-title">ピン留め</div>';
  pinnedItems.forEach((item) => {
    const card = document.createElement("div");
    card.className = "pinned-message-card";
    card.textContent = `${item.user}: ${item.text || "画像"}`;
    pinnedMessagesContainer.appendChild(card);
  });
}

function renderMessages() {
  messages.innerHTML = "";
  const visibleMessages = getVisibleMessages();
  if (visibleMessages.length === 0 && searchQuery.trim()) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "該当するメッセージはありません";
    messages.appendChild(empty);
  } else {
    visibleMessages.forEach((message) => appendMessageToDOM(message));
  }
  renderPinnedMessages();
  scrollToBottom();
}

function renderChannels() {
  if (!channelList) return;
  channelList.innerHTML = "";
  channels.forEach((name) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = `channel${name === currentChannel ? " active" : ""}`;
    button.textContent = `# ${name}`;
    button.dataset.channel = name;
    button.addEventListener("click", () => switchChannel(name));
    item.appendChild(button);
    channelList.appendChild(item);
  });
}

function switchChannel(channel) {
  const nextChannel = channel || "general";
  currentChannel = nextChannel;
  if (channelTitle) {
    channelTitle.textContent = `# ${nextChannel}`;
  }
  if (!channelMessages[nextChannel]) {
    channelMessages[nextChannel] = loadMessagesForChannel(nextChannel);
  }
  messageHistory = channelMessages[nextChannel];
  users = [];
  renderChannels();
  renderMessages();
  renderUserList();
  if (connected && socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "switchChannel", channel: nextChannel }));
  }
}

function appendMessageToDOM(message) {
  const item = normalizeMessage(message);
  const article = document.createElement("article");
  article.className = `message${item.type === "system" ? " system-message" : ""}`;

  if (item.type !== "system") {
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = item.user.charAt(0).toUpperCase();
    article.appendChild(avatar);
  }

  const body = document.createElement("div");
  body.className = "message-body";

  if (item.type !== "system") {
    const meta = document.createElement("div");
    meta.className = "message-meta";

    const author = document.createElement("strong");
    author.textContent = item.user;
    const time = document.createElement("span");
    time.textContent = formatTime(item.time);

    meta.append(author, time);
    body.appendChild(meta);
  }

  if (item.replyTo) {
    const quote = document.createElement("div");
    quote.className = "quote-box";
    quote.textContent = `返信: ${item.replyTo.user}: ${item.replyTo.text}`;
    body.appendChild(quote);
  }

  if (item.type === "image" && item.image) {
    const img = document.createElement("img");
    img.className = "message-image";
    img.src = item.image;
    img.alt = "送信された画像";
    body.appendChild(img);
  } else if (item.text) {
    const paragraph = document.createElement("p");
    paragraph.textContent = item.text;
    body.appendChild(paragraph);
  }

  if (item.type !== "system" && item.user === currentUser) {
    const actions = document.createElement("div");
    actions.className = "message-actions";

    const editButton = document.createElement("button");
    editButton.className = "message-action-btn";
    editButton.textContent = "編集";
    editButton.dataset.action = "edit";
    editButton.dataset.id = item.id;

    const deleteButton = document.createElement("button");
    deleteButton.className = "message-action-btn";
    deleteButton.textContent = "削除";
    deleteButton.dataset.action = "delete";
    deleteButton.dataset.id = item.id;

    const replyButton = document.createElement("button");
    replyButton.className = "message-action-btn";
    replyButton.textContent = "引用";
    replyButton.dataset.action = "reply";
    replyButton.dataset.id = item.id;

    const pinButton = document.createElement("button");
    pinButton.className = "message-action-btn";
    pinButton.textContent = item.pinned ? "ピン解除" : "ピン留め";
    pinButton.dataset.action = item.pinned ? "unpin" : "pin";
    pinButton.dataset.id = item.id;

    actions.append(editButton, deleteButton, replyButton, pinButton);
    body.appendChild(actions);
  }

  article.appendChild(body);
  messages.appendChild(article);
}

function renderUserList() {
  if (!userList) return;
  userList.innerHTML = "";
  users.forEach((name) => {
    const item = document.createElement("li");
    item.textContent = name;
    userList.appendChild(item);
  });
  if (memberCount) {
    memberCount.textContent = `${users.length}人`;
  }
}

function renderAdminPanel() {
  if (!adminPanel || !adminUserList) return;
  if (!isAdmin) {
    adminPanel.hidden = true;
    return;
  }
  adminPanel.hidden = false;
  adminUserList.innerHTML = "";
  if (adminUsers.length === 0) {
    const item = document.createElement("li");
    item.textContent = "登録済みユーザーはいません";
    adminUserList.appendChild(item);
    return;
  }
  adminUsers.forEach((user) => {
    const item = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = `${user.name} (${user.role || "user"})`;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "削除";
    button.addEventListener("click", () => deleteUser(user.name));
    item.append(label, button);
    adminUserList.appendChild(item);
  });
}

function playNotificationSound() {
  if (typeof window === "undefined") return;
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioContext.state === "suspended") {
    audioContext.resume();
  }

  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = 880;
  gainNode.gain.value = 0.05;
  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  oscillator.start();
  gainNode.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.2);
  oscillator.stop(audioContext.currentTime + 0.2);
}

function applyIncomingMessage(payload) {
  const channel = payload.channel || currentChannel;
  const message = normalizeMessage(payload, channel);
  const list = channelMessages[channel] || [];
  const existingIndex = list.findIndex((item) => item.id === message.id);
  if (existingIndex >= 0) {
    list[existingIndex] = message;
  } else {
    list.push(message);
  }
  channelMessages[channel] = list;

  if (channel === currentChannel) {
    messageHistory = list;
    if (message.user !== currentUser && message.type !== "system") {
      playNotificationSound();
    }
    renderMessages();
  }

  saveMessages(channel);
}

function handleIncomingPayload(payload) {
  if (payload.type === "channels") {
    channels = payload.channels || []; 
    if (!channels.includes(currentChannel)) {
      switchChannel(channels[0] || "general");
    } else {
      renderChannels();
    }
    return;
  }

  if (payload.type === "history") {
    const channel = payload.channel || currentChannel;
    channelMessages[channel] = (payload.messages || []).map((item) => normalizeMessage(item, channel));
    if (channel === currentChannel) {
      messageHistory = channelMessages[channel];
      renderMessages();
    }
    saveMessages(channel);
    return;
  }

  if (payload.type === "message" || payload.type === "image") {
    applyIncomingMessage(payload);
  } else if (payload.type === "typing") {
    const channel = payload.channel || currentChannel;
    if (channel === currentChannel && payload.user && payload.user !== currentUser) {
      typingIndicator.textContent = `${payload.user} が入力中...`;
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => {
        typingIndicator.textContent = "　";
      }, 1000);
    }
  } else if (payload.type === "pin") {
    const channel = payload.channel || currentChannel;
    const target = (channelMessages[channel] || []).find((item) => item.id === payload.id);
    if (target) {
      target.pinned = Boolean(payload.pinned);
      saveMessages(channel);
      if (channel === currentChannel) {
        messageHistory = channelMessages[channel];
        renderMessages();
      }
    }
  } else if (payload.type === "edit") {
    const channel = payload.channel || currentChannel;
    const target = (channelMessages[channel] || []).find((item) => item.id === payload.id);
    if (target) {
      target.text = payload.text;
      target.time = payload.time || new Date().toISOString();
      saveMessages(channel);
      if (channel === currentChannel) {
        messageHistory = channelMessages[channel];
        renderMessages();
      }
    }
  } else if (payload.type === "delete") {
    const channel = payload.channel || currentChannel;
    channelMessages[channel] = (channelMessages[channel] || []).filter((item) => item.id !== payload.id);
    saveMessages(channel);
    if (channel === currentChannel) {
      messageHistory = channelMessages[channel];
      renderMessages();
    }
  } else if (payload.type === "users") {
    if (!payload.channel || payload.channel === currentChannel) {
      users = payload.users || [];
      renderUserList();
    }
  } else if (payload.type === "loginSuccess") {
    isAdmin = Boolean(payload.admin);
    renderAdminPanel();
  } else if (payload.type === "adminUsers") {
    adminUsers = payload.users || [];
    renderAdminPanel();
  } else if (payload.type === "authError") {
    window.alert(payload.message || "認証に失敗しました");
  } else if (payload.type === "system") {
    const channel = payload.channel || currentChannel;
    const list = channelMessages[channel] || [];
    const systemMessage = normalizeMessage({ id: payload.id || createMessageId(), type: "system", text: payload.text, time: payload.time || new Date().toISOString() }, channel);
    list.push(systemMessage);
    channelMessages[channel] = list;
    saveMessages(channel);
    if (channel === currentChannel) {
      messageHistory = list;
      renderMessages();
    }
  }
}

function connect() {
  if (socket && socket.readyState === WebSocket.OPEN) {
    return;
  }

  currentUser = usernameInput.value.trim() || "Guest";
  usernameInput.value = currentUser;
  setStatus("接続中...", false);

  socket = new WebSocket("ws://localhost:3000");

  socket.addEventListener("open", () => {
    connected = true;
    setStatus("接続済み", true);
    socket.send(JSON.stringify({ type: "login", user: currentUser, password: authToken || "", channel: currentChannel }));
  });

  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    handleIncomingPayload(payload);
  });

  socket.addEventListener("close", () => {
    connected = false;
    users = [];
    renderUserList();
    setStatus("未接続", false);
  });

  socket.addEventListener("error", () => {
    connected = false;
    setStatus("接続エラー", false);
  });
}

function login() {
  const username = loginUsernameInput.value.trim();
  const password = loginPasswordInput.value.trim();
  if (!username || !password) {
    window.alert("ユーザー名とパスワードを入力してください");
    return;
  }

  currentUser = username;
  usernameInput.value = currentUser;
  authToken = password;
  if (loginOverlay) {
    loginOverlay.style.display = "none";
  }
  connect();
}

function disconnect() {
  if (socket) {
    socket.close();
    socket = null;
  }
  connected = false;
  users = [];
  renderUserList();
  setStatus("未接続", false);
}

function logout() {
  disconnect();
  authToken = null;
  currentUser = "Guest";
  usernameInput.value = "Guest";
  loginUsernameInput.value = "";
  loginPasswordInput.value = "";
  if (loginOverlay) {
    loginOverlay.style.display = "flex";
  }
  input.focus();
}

function sendMessage(text) {
  currentUser = usernameInput.value.trim() || "Guest";
  usernameInput.value = currentUser;

  if (!connected || !socket || socket.readyState !== WebSocket.OPEN) {
    connect();
    setTimeout(() => sendMessage(text), 200);
    return;
  }

  const payload = {
    id: createMessageId(),
    type: "message",
    user: currentUser,
    text,
    time: new Date().toISOString(),
    replyTo: replyMessage ? { user: replyMessage.user, text: replyMessage.text } : null,
    channel: currentChannel,
  };

  socket.send(JSON.stringify(payload));
  replyMessage = null;
  updateReplyPreview();
}

function updateReplyPreview() {
  const preview = document.getElementById("reply-preview");
  if (!preview) return;
  if (!replyMessage) {
    preview.innerHTML = "";
    return;
  }
  preview.innerHTML = `<div class="quote-box">返信先: ${replyMessage.user}: ${replyMessage.text}</div>`;
}

function sendImage(file) {
  currentUser = usernameInput.value.trim() || "Guest";
  usernameInput.value = currentUser;

  if (!connected || !socket || socket.readyState !== WebSocket.OPEN) {
    connect();
    setTimeout(() => sendImage(file), 200);
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const payload = {
      id: createMessageId(),
      type: "image",
      user: currentUser,
      image: reader.result,
      time: new Date().toISOString(),
      channel: currentChannel,
    };

    socket.send(JSON.stringify(payload));
  };
  reader.readAsDataURL(file);
}

function editMessage(id) {
  const target = messageHistory.find((item) => item.id === id);
  if (!target) return;
  const nextText = window.prompt("メッセージを編集", target.text);
  if (nextText === null) return;
  const text = nextText.trim();
  if (!text) return;

  socket.send(JSON.stringify({ type: "edit", id, user: currentUser, text, time: new Date().toISOString(), channel: currentChannel }));
}

function deleteMessage(id) {
  if (!window.confirm("このメッセージを削除しますか？")) return;
  socket.send(JSON.stringify({ type: "delete", id, user: currentUser, channel: currentChannel }));
}

function togglePin(id) {
  if (!connected || !socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: "pin", id, user: currentUser, channel: currentChannel }));
}

function createChannel(name) {
  const normalized = normalizeChannelName(name);
  if (!normalized) return;
  if (!connected || !socket || socket.readyState !== WebSocket.OPEN) {
    connect();
    return;
  }
  socket.send(JSON.stringify({ type: "createChannel", channel: normalized }));
}

function deleteUser(username) {
  if (!isAdmin || !connected || !socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: "deleteUser", username }));
}

function deleteChannel(channel) {
  const target = channel || currentChannel;
  if (!target || target === "general") return;
  if (!connected || !socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }
  socket.send(JSON.stringify({ type: "deleteChannel", channel: target }));
}

function replyToMessage(id) {
  replyMessage = messageHistory.find((item) => item.id === id) || null;
  updateReplyPreview();
  input.focus();
}

function insertEmoji(emoji) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  const before = input.value.slice(0, start);
  const after = input.value.slice(end);
  input.value = `${before}${emoji}${after}`;
  const cursor = start + emoji.length;
  input.focus();
  input.setSelectionRange(cursor, cursor);
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;

  sendMessage(text);
  input.value = "";
  input.focus();
});

input.addEventListener("input", () => {
  if (!connected || !socket) return;
  socket.send(JSON.stringify({ type: "typing", user: currentUser, channel: currentChannel }));
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

connectButton.addEventListener("click", () => {
  if (connected) {
    disconnect();
  } else {
    login();
  }
});

logoutButton.addEventListener("click", logout);
loginButton.addEventListener("click", login);
loginPasswordInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    login();
  }
});

imageInput.addEventListener("change", (event) => {
  const file = event.target.files && event.target.files[0];
  if (file) {
    sendImage(file);
  }
  event.target.value = "";
});

emojiButtons.forEach((button) => {
  button.addEventListener("click", () => insertEmoji(button.dataset.emoji || ""));
});

messages.addEventListener("click", (event) => {
  const target = event.target.closest("button[data-action]");
  if (!target) return;
  const { action, id } = target.dataset;
  if (action === "edit") {
    editMessage(id);
  } else if (action === "delete") {
    deleteMessage(id);
  } else if (action === "reply") {
    replyToMessage(id);
  } else if (action === "pin" || action === "unpin") {
    togglePin(id);
  }
});

usernameInput.addEventListener("change", () => {
  currentUser = usernameInput.value.trim() || "Guest";
  usernameInput.value = currentUser;
});

createChannelButton.addEventListener("click", () => {
  createChannel(newChannelInput.value);
  newChannelInput.value = "";
});

themeToggleButton.addEventListener("click", toggleTheme);

searchInput.addEventListener("input", () => {
  searchQuery = searchInput.value;
  renderMessages();
});

newChannelInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    createChannelButton.click();
  }
});

deleteChannelButton.addEventListener("click", () => deleteChannel(currentChannel));

window.addEventListener("DOMContentLoaded", () => {
  messageHistory = loadMessagesForChannel(currentChannel);
  channelMessages[currentChannel] = messageHistory;
  renderChannels();
  renderMessages();
  renderUserList();
  renderAdminPanel();
  updateReplyPreview();
  loginUsernameInput.value = usernameInput.value.trim() || "";
  isLightTheme = localStorage.getItem("discord-chat-theme") === "light";
  applyTheme();
  input.focus();
});

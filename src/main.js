import "./styles.css";
import {
  auth, signOut, onAuthStateChanged,
  getDisplayName, getInitials, renderAuthScreen,
} from "./auth.js";
import {
  ingestDocument, getUserDocs, deleteDocument, retrieveChunks,
  createChatSession, getUserChats, saveMessage, getChatMessages,
  updateChatTitle, deleteChatSession, pinMessage, getPinnedMessages,
  getAnalyticsData, updateDocTags,
} from "./rag.js";
import { streamAnswer } from "./gemini.js";

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  user: null,
  docs: [],
  chats: [],
  activeChatId: null,
  messages: [],        // in-memory mirror of active chat
  isGenerating: false,
  isIngesting: false,
  searchQuery: "",     // for search filtering
  searchActive: false, // UI indicator flag
  pinnedMessages: [], // pinned messages for active chat
  selectedDocs: [],   // for comparison mode (max 2)
  compareMode: false, // active comparison mode flag
};

// ─── Utilities ────────────────────────────────────────────────────────────────
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function relativeTime(ts) {
  if (!ts) return "";
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 10) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  return `${Math.floor(diff / 3600)} hr ago`;
}

let _lastQuery = "";
let _clockInterval = null;
let _currentTheme = "default";

// ─── Theme System ─────────────────────────────────────────────────────────────
function applyTheme(themeId) {
  _currentTheme = themeId;
  if (themeId === "default") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", themeId);
  }
  localStorage.setItem("theme", themeId);
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    renderAuthScreen((authedUser) => bootApp(authedUser));
    return;
  }
  await bootApp(user);
});

async function bootApp(user) {
  state.user = user;
  try {
    [state.docs, state.chats] = await Promise.all([
      getUserDocs(user.uid),
      getUserChats(user.uid),
    ]);
  } catch (e) {
    console.warn("Firestore load:", e.message);
  }
  // Load theme preference
  const savedTheme = localStorage.getItem("theme") || "default";
  applyTheme(savedTheme);
  renderApp();
}

// ─── App Shell ────────────────────────────────────────────────────────────────
function renderApp() {
  const user = state.user;
  const name = getDisplayName(user);
  const initials = getInitials(user);

  document.getElementById("app").innerHTML = `
    <div id="toast-container"></div>
    <input type="file" id="file-input" accept=".pdf" />

    <!-- Header -->
    <header class="header">
      <div class="header-logo">
        <div class="logo-icon">📈</div>
        <span class="logo-text">AlphaInsight</span>
        <span class="logo-pro">PRO</span>
      </div>
      <div class="header-spacer"></div>
      <div class="header-badge" id="live-clock">
        <div class="dot"></div>
        <span id="clock-time">--:--:--</span>
      </div>
      <button class="theme-btn" id="theme-btn" title="Switch theme">🎨</button>
      <button class="stats-btn" id="stats-btn" title="Analytics dashboard">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="2" x2="12" y2="22"/><polyline points="4 7 12 2 20 7"/><polyline points="4 17 12 22 20 17"/>
        </svg>
      </button>
      <div class="header-user">
        <div class="user-avatar" title="${user.email || 'Guest'}">${initials}</div>
        <span class="user-name">${name}</span>
        ${user.isAnonymous ? '<span class="badge-guest">Guest</span>' : ''}
      </div>
      <button class="signout-btn" id="signout-btn" title="Sign out">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
          <polyline points="16 17 21 12 16 7"/>
          <line x1="21" y1="12" x2="9" y2="12"/>
        </svg>
      </button>
    </header>

    <!-- Workspace -->
    <div class="workspace">
      <!-- Sidebar -->
      <aside class="sidebar">

        <!-- Search Panel -->
        <div class="search-panel">
          <div class="search-wrapper">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
            <input type="text" id="search-input" placeholder="Search docs/chats..." />
            <button class="search-clear-btn" id="search-clear-btn" style="display:none;" title="Clear search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
            <div class="search-indicator" id="search-indicator" style="display:none;">SEARCHING</div>
          </div>
        </div>

        <!-- Documents Section -->
        <div class="sidebar-section-header">
          <span class="section-label">[ Documents ]</span>
          <button class="sidebar-action-btn" id="upload-btn" title="Upload PDF">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
        </div>
        <div class="sidebar-list" id="doc-list"></div>

        <div class="sidebar-divider"></div>

        <!-- Chats Section -->
        <div class="sidebar-section-header">
          <span class="section-label">[ Queries ]</span>
          <button class="sidebar-action-btn" id="new-chat-btn" title="New chat">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
        </div>
        <div class="sidebar-list" id="chat-list" style="flex:1;"></div>

      </aside>

      <!-- Chat Area -->
      <main class="chat-area">
        <div id="chat-toolbar" class="chat-toolbar" style="display:none;">
          <span class="chat-toolbar-title" id="chat-toolbar-title">Session</span>
          <div class="chat-toolbar-actions">
            <button class="toolbar-btn" id="export-md-btn" title="Export as Markdown">⬇ MD</button>
            <button class="toolbar-btn" id="export-json-btn" title="Export as JSON">⬇ JSON</button>
          </div>
        </div>
        <div id="chat-body" class="messages" style="display:none;"></div>
        <div id="welcome-screen" class="welcome"></div>
        <div id="compare-banner" class="compare-mode-banner" style="display:none;">
          🔄 COMPARISON MODE — Select 2 documents to compare
        </div>
        <div class="chat-input-area" style="position:relative;">
          <div id="templates-panel" class="templates-panel" style="display:none;">
            <div class="templates-panel-header">Financial Queries</div>
            <div class="templates-panel-body" id="templates-list"></div>
          </div>
          <div class="input-wrapper">
            <textarea id="chat-input" rows="1"
              placeholder="Enter financial query... (Type / for templates)"></textarea>
            <button class="voice-btn" id="voice-btn" title="Voice input">🎤</button>
            <button class="send-btn" id="send-btn" disabled>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          </div>
          <p class="input-hint">> ENTER to send | SHIFT+ENTER for new line | CTRL+K new chat | CTRL+/ search | / for templates</p>
        </div>
      </main>
    </div>`;

  renderDocList();
  renderChatList();
  renderWelcome();
  bindEvents();
}

// ─── Doc List ─────────────────────────────────────────────────────────────────
function renderDocList() {
  const list = document.getElementById("doc-list");
  if (!list) return;

  // Filter docs by search query
  const filteredDocs = state.docs.filter((d) =>
    d.name.toLowerCase().includes(state.searchQuery.toLowerCase())
  );

  if (filteredDocs.length === 0) {
    const msg = state.searchQuery ? `No documents match "<strong>${state.searchQuery}</strong>".` : "No documents yet.<br/>Click + to upload a PDF.";
    list.innerHTML = `<div class="sidebar-empty"><div class="empty-icon">📂</div><span>${msg}</span></div>`;
    return;
  }
  list.innerHTML = filteredDocs.map((d) => {
    const tagsHtml = (d.tags && d.tags.length > 0)
      ? `<div class="doc-tags-row">${d.tags.map(t => `<span class="doc-tag">${t}</span>`).join("")}</div>`
      : "";
    return `
    <div class="doc-item" data-id="${d.id}">
      <input type="checkbox" class="doc-checkbox" data-id="${d.id}" title="Select for comparison" />
      <div class="doc-icon">📄</div>
      <div class="doc-info">
        <div class="doc-name" title="${d.name}">${d.name}</div>
        <div class="doc-meta">${d.chunkCount} chunks · ${d.pages || 0}p · ${formatSize(d.size)}</div>
        ${tagsHtml}
      </div>
      <button class="doc-delete" data-id="${d.id}" title="Delete">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
        </svg>
      </button>
    </div>`;
  }).join("");

  list.querySelectorAll(".doc-delete").forEach((btn) =>
    btn.addEventListener("click", (e) => { e.stopPropagation(); handleDeleteDoc(btn.dataset.id); })
  );

  // Re-attach checkbox handlers
  list.querySelectorAll(".doc-checkbox").forEach((checkbox) => {
    checkbox.addEventListener("change", (e) => {
      const docId = e.target.dataset.id;
      if (e.target.checked) {
        if (state.selectedDocs.length < 2) {
          state.selectedDocs.push(docId);
        } else {
          e.target.checked = false;
          showToast("Max 2 documents for comparison", "warning");
          return;
        }
      } else {
        state.selectedDocs = state.selectedDocs.filter(d => d !== docId);
      }
      state.compareMode = state.selectedDocs.length === 2;
      updateCompareMode();
    });
  });
}

// ─── Chat List ────────────────────────────────────────────────────────────────
function renderChatList() {
  const list = document.getElementById("chat-list");
  if (!list) return;

  // Filter chats by search query
  const filteredChats = state.chats.filter((c) =>
    c.title.toLowerCase().includes(state.searchQuery.toLowerCase())
  );

  if (filteredChats.length === 0) {
    const msg = state.searchQuery ? `No chats match "<strong>${state.searchQuery}</strong>".` : "No chats yet.<br/>Start by asking a question.";
    list.innerHTML = `<div class="sidebar-empty"><div class="empty-icon">💬</div><span>${msg}</span></div>`;
    return;
  }
  list.innerHTML = filteredChats.map((c) => `
    <div class="chat-item ${c.id === state.activeChatId ? "active" : ""}" data-id="${c.id}">
      <div class="chat-item-icon">💬</div>
      <div class="chat-item-info">
        <div class="chat-item-title">${c.title}</div>
        <div class="chat-item-meta">${c.messageCount || 0} messages</div>
      </div>
      <button class="doc-delete" data-id="${c.id}" title="Delete chat">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
        </svg>
      </button>
    </div>`).join("");

  list.querySelectorAll(".chat-item").forEach((item) =>
    item.addEventListener("click", (e) => {
      if (e.target.closest(".doc-delete")) return;
      handleSelectChat(item.dataset.id);
    })
  );
  list.querySelectorAll(".doc-delete").forEach((btn) =>
    btn.addEventListener("click", (e) => { e.stopPropagation(); handleDeleteChat(btn.dataset.id); })
  );
}

// ─── Welcome Screen ───────────────────────────────────────────────────────────
function renderWelcome() {
  const welcome = document.getElementById("welcome-screen");
  if (!welcome) return;
  const hasDocs = state.docs.length > 0;
  const hasMsgs = state.messages.length > 0;

  if (hasMsgs) {
    welcome.style.display = "none";
    document.getElementById("chat-body").style.display = "flex";
    return;
  }
  welcome.style.display = "flex";
  document.getElementById("chat-body").style.display = "none";
  document.getElementById("chat-toolbar").style.display = "none";
  document.getElementById("templates-panel").style.display = "none";

  if (hasDocs) {
    welcome.innerHTML = `
      <div class="welcome-orb">🔍</div>
      <h1>ANALYSIS <span>READY</span></h1>
      <p>${state.docs.length} document${state.docs.length > 1 ? "s" : ""} loaded · Query your financial data</p>
      <div class="welcome-chips">
        ${["What was the total revenue?", "Summarize key highlights", "What are the main risks?", "What is net profit margin?", "Describe cash flow"].map((q) => `<div class="chip" data-q="${q}">${q}</div>`).join("")}
      </div>`;
    welcome.querySelectorAll(".chip").forEach((chip) =>
      chip.addEventListener("click", () => {
        document.getElementById("chat-input").value = chip.dataset.q;
        handleSend();
      })
    );
  } else {
    welcome.innerHTML = `
      <div class="welcome-orb">📈</div>
      <h1><span>ALPHAINSIGHT</span> PRO</h1>
      <p>Upload financial reports, earnings filings, or PDFs to analyze — powered by Gemini AI</p>
      <div class="welcome-chips">
        <div class="chip chip--decorative">📊 Reports</div>
        <div class="chip chip--decorative">📑 10-K / 10-Q</div>
        <div class="chip chip--decorative">💹 Earnings</div>
        <div class="chip chip--decorative">📋 Statements</div>
      </div>`;
  }
}

// ─── Search Events ────────────────────────────────────────────────────────────
function bindSearchEvents() {
  const searchInput = document.getElementById("search-input");
  const clearBtn = document.getElementById("search-clear-btn");

  const debouncedRender = debounce(() => {
    renderDocList();
    renderChatList();
  }, 150);

  searchInput?.addEventListener("input", (e) => {
    state.searchQuery = e.target.value.trim();
    clearBtn.style.display = state.searchQuery ? "flex" : "none";
    state.searchActive = state.searchQuery.length > 0;
    document.getElementById("search-indicator").style.display = state.searchActive ? "block" : "none";
    debouncedRender();
  });

  searchInput?.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      state.searchQuery = "";
      searchInput.value = "";
      clearBtn.style.display = "none";
      state.searchActive = false;
      document.getElementById("search-indicator").style.display = "none";
      renderDocList();
      renderChatList();
    }
  });

  clearBtn?.addEventListener("click", () => {
    state.searchQuery = "";
    searchInput.value = "";
    clearBtn.style.display = "none";
    state.searchActive = false;
    document.getElementById("search-indicator").style.display = "none";
    renderDocList();
    renderChatList();
  });
}

// ─── Query Templates ──────────────────────────────────────────────────────────
const QUERY_TEMPLATES = [
  { label: "Revenue Summary", q: "What was the total revenue and year-over-year growth?" },
  { label: "Profit Analysis", q: "What is the net profit margin and EBITDA?" },
  { label: "Risk Assessment", q: "What are the key risk factors mentioned in this document?" },
  { label: "Cash Flow", q: "Describe the cash flow from operations and free cash flow." },
  { label: "Balance Sheet", q: "What are the total assets, liabilities, and equity?" },
  { label: "Key Highlights", q: "Summarize the 5 most important highlights from this document." },
  { label: "Expense Breakdown", q: "What are the major operating expenses and their trends?" },
  { label: "Management Outlook", q: "What forward-looking statements or guidance did management provide?" },
  { label: "Dividend Info", q: "What is the dividend policy and recent dividend history?" },
  { label: "Debt Structure", q: "Describe the long-term debt and credit facilities." },
];

function showTemplatesPanel() {
  const panel = document.getElementById("templates-panel");
  const list = document.getElementById("templates-list");
  if (!panel || !list) return;

  list.innerHTML = QUERY_TEMPLATES.map((t) =>
    `<div class="template-item" data-q="${t.q}">${t.label}</div>`
  ).join("");

  panel.style.display = "block";

  // Attach click handlers
  list.querySelectorAll(".template-item").forEach((item) => {
    item.addEventListener("click", () => {
      document.getElementById("chat-input").value = item.dataset.q;
      document.getElementById("chat-input").dispatchEvent(new Event("input"));
      panel.style.display = "none";
      handleSend();
    });
  });

  // Close on ESC
  const closePanel = (e) => {
    if (e.key === "Escape") {
      panel.style.display = "none";
      document.removeEventListener("keydown", closePanel);
    }
  };
  document.addEventListener("keydown", closePanel);
}

// ─── Export Functions ────────────────────────────────────────────────────────
function handleExportChat(format) {
  if (!state.messages.length) { showToast("No messages to export.", "warning"); return; }
  const chatTitle = state.chats.find(c => c.id === state.activeChatId)?.title || "chat";
  let content, mimeType, ext;

  if (format === "md") {
    content = `# ${chatTitle}\n\n` + state.messages.map(m => {
      const role = m.role === "ai" ? "**AlphaInsight Pro**" : "**You**";
      const time = m.createdAt ? new Date(m.createdAt?.toMillis?.() ?? m.createdAt).toLocaleString() : "";
      const src = m.sources?.length ? `\n_Sources: ${m.sources.join(", ")}_` : "";
      return `### ${role} ${time}\n\n${m.text}${src}`;
    }).join("\n\n---\n\n");
    mimeType = "text/markdown";
    ext = "md";
  } else {
    content = JSON.stringify({ title: chatTitle, exportedAt: new Date().toISOString(), messages: state.messages }, null, 2);
    mimeType = "application/json";
    ext = "json";
  }

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${chatTitle.toLowerCase().replace(/\s+/g, "-")}.${ext}`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`Exported as .${ext} ✓`, "success");
}

// ─── Voice Input ──────────────────────────────────────────────────────────────
function bindVoiceInput() {
  const voiceBtn = document.getElementById("voice-btn");
  if (!voiceBtn) return;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    voiceBtn.style.display = "none";
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.lang = "en-US";
  recognition.interimResults = true;

  let isListening = false;
  voiceBtn.addEventListener("click", () => {
    if (isListening) { recognition.stop(); return; }
    recognition.start();
    isListening = true;
    voiceBtn.classList.add("listening");
    voiceBtn.textContent = "🔴";
  });

  recognition.onresult = (e) => {
    const transcript = Array.from(e.results).map(r => r[0].transcript).join("");
    document.getElementById("chat-input").value = transcript;
    document.getElementById("chat-input").dispatchEvent(new Event("input"));
  };

  recognition.onend = () => {
    isListening = false;
    voiceBtn.classList.remove("listening");
    voiceBtn.textContent = "🎤";
  };
}

// ─── Events ───────────────────────────────────────────────────────────────────
function bindEvents() {
  document.getElementById("upload-btn")?.addEventListener("click", () =>
    document.getElementById("file-input").click()
  );
  bindSearchEvents();
  document.getElementById("stats-btn")?.addEventListener("click", handleShowAnalytics);
  document.getElementById("theme-btn")?.addEventListener("click", () => {
    const themes = ["default", "blue", "gold"];
    const nextTheme = themes[(themes.indexOf(_currentTheme) + 1) % themes.length];
    applyTheme(nextTheme);
  });
  document.getElementById("export-md-btn")?.addEventListener("click", () => handleExportChat("md"));
  document.getElementById("export-json-btn")?.addEventListener("click", () => handleExportChat("json"));

  document.getElementById("file-input")?.addEventListener("change", (e) => {
    if (e.target.files[0]) handleUpload(e.target.files[0]);
    e.target.value = "";
  });
  document.getElementById("new-chat-btn")?.addEventListener("click", handleNewChat);
  document.getElementById("signout-btn")?.addEventListener("click", handleSignOut);

  const inputEl = document.getElementById("chat-input");
  inputEl?.addEventListener("input", () => {
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + "px";
    document.getElementById("send-btn").disabled =
      !inputEl.value.trim() || state.isGenerating || state.docs.length === 0;
  });
  inputEl?.addEventListener("keydown", (e) => {
    if (e.key === "/" && !inputEl.value.trim()) {
      e.preventDefault();
      showTemplatesPanel();
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!document.getElementById("send-btn").disabled) handleSend();
    }
  });
  document.getElementById("send-btn")?.addEventListener("click", handleSend);

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "k") {
      e.preventDefault();
      handleNewChat();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "/") {
      e.preventDefault();
      document.getElementById("search-input")?.focus();
    }
  });

  bindVoiceInput();

  // Start live clock
  const clockEl = document.getElementById("clock-time");
  if (clockEl) {
    const updateClock = () => {
      clockEl.textContent = new Date().toLocaleTimeString("en-US", { hour12: false });
    };
    updateClock();
    clearInterval(_clockInterval);
    _clockInterval = setInterval(updateClock, 1000);
  }
}

function updateCompareMode() {
  const banner = document.getElementById("compare-banner");
  if (banner) {
    banner.style.display = state.compareMode ? "block" : "none";
  }
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function handleUpload(file) {
  if (!file.name.toLowerCase().endsWith(".pdf")) { showToast("Only PDF files are supported.", "error"); return; }
  if (file.size > 25 * 1024 * 1024) { showToast("File too large — max 25 MB.", "error"); return; }
  if (state.isIngesting) { showToast("Already processing a file, please wait.", "warning"); return; }

  state.isIngesting = true;
  showUploadModal(file.name);

  try {
    const docMetaId = await ingestDocument(state.user.uid, file, (label, pct) => updateUploadModal(label, pct));

    // Bust chunk cache and prompt for tags
    sessionStorage.removeItem(`chunks_${state.user.uid}`);
    await retrieveChunks(state.user.uid, "dummy", 1, true);

    state.docs = await getUserDocs(state.user.uid);
    renderDocList();
    renderWelcome();
    hideUploadModal();

    // Show tag prompt
    const tagInput = prompt("Add tags for this document (optional, comma-separated):");
    if (tagInput && tagInput.trim()) {
      const tags = tagInput.split(",").map(t => t.trim()).filter(Boolean);
      await updateDocTags(state.user.uid, docMetaId, tags);
      state.docs = await getUserDocs(state.user.uid);
      renderDocList();
    }

    showToast(`"${file.name}" indexed! Ready to query. 🎉`, "success");
  } catch (err) {
    console.error(err);
    hideUploadModal();
    showToast(`Upload failed: ${err.message}`, "error");
  } finally {
    state.isIngesting = false;
  }
}

async function handleDeleteDoc(docMetaId) {
  const d = state.docs.find((x) => x.id === docMetaId);
  if (!d || !confirm(`Delete "${d.name}" and all its data from the server?`)) return;
  try {
    await deleteDocument(state.user.uid, docMetaId);
    state.docs = state.docs.filter((x) => x.id !== docMetaId);
    // Bust chunk cache
    sessionStorage.removeItem(`chunks_${state.user.uid}`);
    // Remove from selected docs if present
    state.selectedDocs = state.selectedDocs.filter(id => id !== docMetaId);
    state.compareMode = state.selectedDocs.length === 2;
    updateCompareMode();
    renderDocList();
    renderWelcome();
    showToast("Document removed from server.", "info");
  } catch (e) { showToast("Failed to delete document.", "error"); }
}

async function handleNewChat() {
  try {
    const chatId = await createChatSession(state.user.uid, "New Chat");
    state.activeChatId = chatId;
    state.messages = [];
    state.selectedDocs = [];
    state.compareMode = false;
    state.chats = await getUserChats(state.user.uid);
    renderChatList();
    renderMessages();
    renderWelcome();
    // Show toolbar for new chat
    const toolbar = document.getElementById("chat-toolbar");
    if (toolbar) {
      toolbar.style.display = "flex";
      document.getElementById("chat-toolbar-title").textContent = "New Chat";
    }
    document.getElementById("templates-panel").style.display = "none";
    updateCompareMode();
  } catch (e) { showToast("Could not create new chat.", "error"); }
}

async function handleSelectChat(chatId) {
  state.activeChatId = chatId;
  state.selectedDocs = [];
  state.compareMode = false;
  updateCompareMode();
  renderChatList(); // Update active highlight immediately

  // Show toolbar and hide templates
  const toolbar = document.getElementById("chat-toolbar");
  const chat = state.chats.find(c => c.id === chatId);
  if (toolbar) {
    toolbar.style.display = "flex";
    document.getElementById("chat-toolbar-title").textContent = chat?.title || "Session";
  }
  document.getElementById("templates-panel").style.display = "none";

  // Show skeleton loading
  const body = document.getElementById("chat-body");
  if (body) {
    document.getElementById("welcome-screen").style.display = "none";
    body.style.display = "flex";
    body.innerHTML = `
      <div class="skeleton-row"></div>
      <div class="skeleton-row skeleton-short"></div>
      <div class="skeleton-row"></div>
    `;
  }

  try {
    const msgs = await getChatMessages(state.user.uid, chatId);
    state.messages = msgs;
    state.pinnedMessages = await getPinnedMessages(state.user.uid, chatId);
    renderChatList();
    renderMessages();
    renderPinnedPanel();
  } catch (e) {
    if (body) body.innerHTML = "";
    showToast("Failed to load chat history.", "error");
  }
}

async function handleDeleteChat(chatId) {
  if (!confirm("Delete this chat session?")) return;
  try {
    await deleteChatSession(state.user.uid, chatId);
    state.chats = state.chats.filter((c) => c.id !== chatId);
    if (state.activeChatId === chatId) {
      state.activeChatId = null;
      state.messages = [];
      state.selectedDocs = [];
      state.compareMode = false;
      const toolbar = document.getElementById("chat-toolbar");
      if (toolbar) toolbar.style.display = "none";
      updateCompareMode();
    }
    renderChatList();
    renderMessages();
    renderWelcome();
    showToast("Chat deleted.", "info");
  } catch (e) { showToast("Failed to delete chat.", "error"); }
}

async function handleSignOut() {
  await signOut(auth);
  // onAuthStateChanged will trigger renderAuthScreen
}

async function handleSend() {
  const inputEl = document.getElementById("chat-input");
  const query = inputEl?.value.trim();
  if (!query || state.isGenerating) return;

  // Remove old suggestion chips at START
  document.querySelectorAll(".suggestion-chips-row").forEach((el) => el.remove());

  _lastQuery = query;
  inputEl.value = "";
  inputEl.style.height = "auto";
  document.getElementById("send-btn").disabled = true;
  document.getElementById("send-btn")?.classList.add("generating");

  // Ensure we have an active chat session
  if (!state.activeChatId) {
    state.activeChatId = await createChatSession(state.user.uid, query.slice(0, 50));
    state.chats = await getUserChats(state.user.uid);
    renderChatList();
  }

  // Show chat, hide welcome
  document.getElementById("welcome-screen").style.display = "none";
  document.getElementById("chat-body").style.display = "flex";

  // Persist user message to Firestore (backend)
  await saveMessage(state.user.uid, state.activeChatId, "user", query, []);
  state.messages.push({ role: "user", text: query, sources: [], createdAt: Date.now() });
  appendMessageEl({ role: "user", text: query, createdAt: Date.now() });

  // Auto-title chat after first message
  if (state.messages.length === 1) {
    await updateChatTitle(state.user.uid, state.activeChatId, query.slice(0, 45));
  }

  state.isGenerating = true;
  const typingId = appendTypingEl();

  try {
    // Build conversation history (last 6 turns, excluding current)
    const history = state.messages.slice(-6);
    const historyBlock = history.length > 0
      ? "CONVERSATION HISTORY:\n" +
        history.map(m => `${m.role === 'user' ? 'USER' : 'ANALYST'}: ${m.text.slice(0, 200)}`).join('\n') +
        "\n────────────────────────────\n"
      : "";

    // Retrieve chunks with optional doc filter for comparison mode
    const chunks = await retrieveChunks(state.user.uid, query, 6, false, state.compareMode ? state.selectedDocs : null);
    const context = chunks.map((c, i) => `[${i + 1}] (${c.docName})\n${c.text}`).join("\n\n---\n\n");
    const sources = [...new Set(chunks.map((c) => c.docName))];

    // Build prompt with optional comparison framing
    let prompt = `${historyBlock}FINANCIAL DOCUMENT CONTEXT:\n────────────────────────────\n${context}\n────────────────────────────\n\nUSER QUESTION: ${query}\n\n`;
    if (state.compareMode && state.selectedDocs.length === 2) {
      prompt += `This is a COMPARISON query across multiple documents. Highlight similarities and differences where relevant.`;
    } else {
      prompt += `Answer based strictly on the context. Be concise and cite numbers where relevant.`;
    }

    fadeRemoveEl(typingId);
    const now = Date.now();
    const msgId = appendMessageEl({ role: "ai", text: "", sources, createdAt: now });
    let fullText = "";

    await streamAnswer(prompt, (_, full) => {
      fullText = full;
      updateMessageEl(msgId, full);
    });

    // Persist AI response to Firestore (backend) and get the Firestore ID
    const fsId = await saveMessage(state.user.uid, state.activeChatId, "ai", fullText, sources);
    state.messages.push({ role: "ai", text: fullText, sources, id: fsId, pinned: false, createdAt: now });
    state.chats = await getUserChats(state.user.uid);
    renderChatList();

    // Render suggestion chips after streaming completes
    renderSuggestionChips(query, fullText);

  } catch (err) {
    fadeRemoveEl(typingId);
    console.error(err);
    const errId = appendMessageEl({ role: "ai", text: `ERROR: ${err.message}`, createdAt: Date.now() });
    // Inject retry button
    const errBubble = document.getElementById(`${errId}-b`);
    if (errBubble) {
      errBubble.insertAdjacentHTML("beforeend", `
        <div style="margin-top:8px;">
          <button class="retry-btn" id="retry-btn">↻ RETRY</button>
        </div>
      `);
      document.getElementById("retry-btn")?.addEventListener("click", () => {
        document.getElementById("chat-input").value = _lastQuery;
        handleSend();
      });
    }
  } finally {
    state.isGenerating = false;
    const sb = document.getElementById("send-btn");
    if (sb) {
      sb.classList.remove("generating");
      sb.disabled = !document.getElementById("chat-input")?.value.trim();
    }
  }
}

// ─── Message Rendering ────────────────────────────────────────────────────────

function renderMessages() {
  const body = document.getElementById("chat-body");
  if (!body) return;
  if (state.messages.length === 0) {
    body.style.display = "none";
    body.innerHTML = "";
    return;
  }
  body.style.display = "flex";
  body.innerHTML = "";
  state.messages.forEach((m) => {
    const createdAtMs = m.createdAt?.toMillis?.() ?? m.createdAt ?? null;
    appendMessageEl({
      role: m.role,
      text: m.text,
      sources: m.sources || [],
      id: m.id,
      pinned: m.pinned || false,
      createdAt: createdAtMs,
    });
  });
}

let _msgId = 0;
function appendMessageEl({ role, text, sources = [], id: fsId = null, pinned = false, createdAt = null }) {
  const id = `m${++_msgId}`;
  const body = document.getElementById("chat-body");
  if (!body) return id;
  const srcHtml = sources.length
    ? `<div class="message-sources">${sources.map((s) => `<span class="source-tag">📄 ${s}</span>`).join("")}</div>`
    : "";
  const copyBtnHtml = role === "ai"
    ? `<button class="copy-msg-btn" title="Copy response">⎘</button>`
    : "";
  const regenBtnHtml = role === "ai"
    ? `<button class="regen-btn" title="Regenerate response">↻</button>`
    : "";
  const pinBtnHtml = role === "ai"
    ? `<button class="pin-btn ${pinned ? "pinned" : ""}" data-fsid="${fsId}" title="${pinned ? "Unpin" : "Pin"}">📌</button>`
    : "";

  body.insertAdjacentHTML("beforeend", `
    <div class="message ${role}" id="${id}" ${fsId ? `data-fsid="${fsId}"` : ""}>
      <div class="message-avatar">${role === "ai" ? "✦" : "👤"}</div>
      <div class="message-body">
        <div class="message-name" style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <div>
            <span>${role === "ai" ? "AlphaInsight Pro" : "You"}</span>
            <span class="msg-time" title="${createdAt ? new Date(createdAt).toLocaleTimeString() : ''}">${relativeTime(createdAt)}</span>
          </div>
          <div class="msg-actions">
            ${copyBtnHtml}
            ${regenBtnHtml}
            ${pinBtnHtml}
          </div>
        </div>
        <div class="message-bubble" id="${id}-b">${fmt(text)}</div>
        ${role === "ai" ? srcHtml : ""}
      </div>
    </div>`);

  // Attach copy button handler if present
  if (role === "ai") {
    const copyBtn = body.querySelector(`#${id} .copy-msg-btn`);
    if (copyBtn) {
      copyBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(text).then(() => {
          copyBtn.textContent = "✓";
          setTimeout(() => { copyBtn.textContent = "⎘"; }, 2000);
        });
      });
    }

    // Attach regen button handler
    const regenBtn = body.querySelector(`#${id} .regen-btn`);
    if (regenBtn) {
      regenBtn.addEventListener("click", () => {
        // Find the preceding user message
        const msgIndex = state.messages.findIndex(m => m.id === fsId);
        const precedingUser = msgIndex > 0 ? state.messages[msgIndex - 1] : null;
        const q = precedingUser?.text || _lastQuery;
        if (q) {
          document.getElementById("chat-input").value = q;
          document.getElementById("chat-input").dispatchEvent(new Event("input"));
          handleSend();
        }
      });
    }

    // Attach pin button handler if present
    if (fsId) {
      const pinBtn = body.querySelector(`[data-fsid="${fsId}"] .pin-btn`);
      pinBtn?.addEventListener("click", () => handlePinMessage(fsId, !pinned));
    }
  }

  body.scrollTop = body.scrollHeight;
  return id;
}

function updateMessageEl(id, text) {
  const bubble = document.getElementById(`${id}-b`);
  if (bubble) { bubble.innerHTML = fmt(text); document.getElementById("chat-body").scrollTop = 99999; }
}

function appendTypingEl() {
  const id = `t${++_msgId}`;
  document.getElementById("chat-body")?.insertAdjacentHTML("beforeend", `
    <div class="message ai" id="${id}">
      <div class="message-avatar">✦</div>
      <div class="message-body">
        <div class="message-name">AlphaInsight Pro</div>
        <div class="message-bubble"><div class="typing"><span></span><span></span><span></span></div></div>
      </div>
    </div>`);
  document.getElementById("chat-body").scrollTop = 99999;
  return id;
}

function removeEl(id) { document.getElementById(id)?.remove(); }

// ─── Pinned Messages ──────────────────────────────────────────────────────────

function renderPinnedPanel() {
  const existingPanel = document.getElementById("pinned-panel");
  existingPanel?.remove();

  if (!state.pinnedMessages || state.pinnedMessages.length === 0) return;

  const body = document.getElementById("chat-body");
  if (!body) return;

  const html = `
    <div id="pinned-panel" class="pinned-panel">
      <div class="pinned-header">📌 PINNED</div>
      <div class="pinned-body">
        ${state.pinnedMessages.map((m) => `
          <div class="pinned-item" data-msgid="${m.id}">
            <div class="pinned-item-text">${m.text.slice(0, 80).replace(/</g, "&lt;").replace(/>/g, "&gt;")}…</div>
            <button class="unpin-btn" data-msgid="${m.id}" title="Unpin">✕</button>
          </div>
        `).join("")}
      </div>
    </div>
  `;

  body.insertAdjacentHTML("afterbegin", html);

  // Attach event handlers
  const panel = document.getElementById("pinned-panel");
  panel.querySelectorAll(".pinned-item").forEach((item) => {
    item.addEventListener("click", () => {
      const msgId = item.dataset.msgid;
      const msgEl = document.querySelector(`[data-fsid="${msgId}"]`);
      if (msgEl) msgEl.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });

  panel.querySelectorAll(".unpin-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      handlePinMessage(btn.dataset.msgid, false);
    });
  });
}

async function handlePinMessage(msgId, pinned) {
  try {
    await pinMessage(state.user.uid, state.activeChatId, msgId, pinned);
    state.pinnedMessages = await getPinnedMessages(state.user.uid, state.activeChatId);

    // Update button state
    const pinBtn = document.querySelector(`[data-fsid="${msgId}"] .pin-btn`);
    if (pinBtn) {
      pinBtn.classList.toggle("pinned", pinned);
      pinBtn.title = pinned ? "Unpin" : "Pin";
    }

    renderPinnedPanel();
    showToast(pinned ? "Message pinned ✓" : "Message unpinned", "info");
  } catch (e) {
    console.error(e);
    showToast("Failed to update pin status.", "error");
  }
}

// ─── Suggestion Chips ─────────────────────────────────────────────────────────

function renderSuggestionChips(query, responseText) {
  // Remove old chips
  document.querySelectorAll(".suggestion-chips-row").forEach((el) => el.remove());

  // Detect keywords and pick suggestion category
  const query_lower = query.toLowerCase();
  const response_lower = responseText.toLowerCase();
  const combined = (query_lower + " " + response_lower).toLowerCase();

  let suggestions = [];
  if (combined.includes("revenue") || combined.includes("sales")) {
    suggestions = [
      "What was the year-over-year revenue growth?",
      "Break down revenue by segment",
      "What are the revenue projections?"
    ];
  } else if (combined.includes("expense") || combined.includes("cost")) {
    suggestions = [
      "What are the major operating expenses?",
      "How do expenses compare to revenue?",
      "What cost-saving initiatives are planned?"
    ];
  } else if (combined.includes("risk") || combined.includes("challenge")) {
    suggestions = [
      "What are the key risk factors?",
      "How does the company mitigate risks?",
      "What regulatory risks are mentioned?"
    ];
  } else if (combined.includes("profit") || combined.includes("margin")) {
    suggestions = [
      "What is the profit margin trend?",
      "How does profitability compare to competitors?",
      "What is the net income?"
    ];
  } else if (combined.includes("cash") || combined.includes("liquidity")) {
    suggestions = [
      "What is the cash position?",
      "Describe the cash flow from operations",
      "What are the liquidity needs?"
    ];
  } else {
    suggestions = [
      "Can you summarize the key metrics?",
      "What are the main highlights?",
      "What forward-looking statements are made?"
    ];
  }

  // Insert chips after the AI message
  const lastMsg = document.querySelector(".message.ai:last-of-type");
  if (!lastMsg) return;

  const chipsHtml = `
    <div class="suggestion-chips-row">
      <span class="chips-label">> FOLLOW-UP:</span>
      ${suggestions.slice(0, 3).map((q) => `<div class="chip" data-q="${q}">${q}</div>`).join("")}
    </div>
  `;

  lastMsg.insertAdjacentHTML("afterend", chipsHtml);

  // Attach chip click handlers
  document.querySelectorAll(".suggestion-chips-row .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.getElementById("chat-input").value = chip.dataset.q;
      handleSend();
    });
  });
}

function fmt(text) {
  if (!text) return "";
  return text
    // HTML escape first
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    // Headings: ### → h4, ## → h3, # → h2
    .replace(/^### (.+)$/gm, '<h4 class="msg-h3">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 class="msg-h2">$1</h3>')
    .replace(/^# (.+)$/gm, '<h2 class="msg-h1">$1</h2>')
    // Bold + italic
    .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    // Code
    .replace(/`([^`]+)`/g, '<code class="message-code">$1</code>')
    // Blockquote
    .replace(/^&gt; (.+)$/gm, '<div class="msg-blockquote">$1</div>')
    // Horizontal rule
    .replace(/^---+$/gm, '<hr class="msg-hr"/>')
    // Bullet lists (convert consecutive - lines into <ul>)
    .replace(/(^[-*] .+\n?)+/gm, (m) => {
      const items = m.trim().split('\n').map(l => `<li>${l.replace(/^[-*] /, '')}</li>`).join('');
      return `<ul class="msg-list">${items}</ul>`;
    })
    // Numbered lists (convert consecutive 1. lines)
    .replace(/(^\d+\. .+\n?)+/gm, (m) => {
      const items = m.trim().split('\n').map(l => `<li>${l.replace(/^\d+\. /, '')}</li>`).join('');
      return `<ol class="msg-list">${items}</ol>`;
    })
    // Newlines (outside block elements)
    .replace(/\n/g, "<br/>");
}

// ─── Upload Progress Modal ────────────────────────────────────────────────────
function showUploadModal(fileName) {
  // Remove if exists
  document.getElementById("upload-modal")?.remove();
  document.body.insertAdjacentHTML("beforeend", `
    <div id="upload-modal" class="upload-modal-overlay">
      <div class="upload-modal-card">
        <div class="upload-modal-icon">⏳</div>
        <div class="upload-modal-title">Processing Document</div>
        <div class="upload-modal-file">${fileName}</div>
        <div class="upload-modal-bar-track">
          <div class="upload-modal-bar-fill" id="modal-bar" style="width:5%"></div>
        </div>
        <div class="upload-modal-step" id="modal-step">Preparing…</div>
        <div class="upload-modal-pulse">
          <span></span><span></span><span></span>
          <span class="upload-modal-alive">Working — please keep this tab open</span>
        </div>
        <p class="upload-modal-note">
          💡 Larger PDFs take longer. Each chunk must be embedded via the Gemini API.
        </p>
      </div>
    </div>`);
}

function updateUploadModal(label, pct) {
  const bar = document.getElementById("modal-bar");
  const step = document.getElementById("modal-step");
  if (bar) bar.style.width = `${pct}%`;
  if (step) step.textContent = label;
}

function hideUploadModal() {
  document.getElementById("upload-modal")?.remove();
}

function showToast(msg, type = "info") {
  const c = document.getElementById("toast-container");
  if (!c) return;
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;

  el.addEventListener("click", () => dismissToast(el));

  c.appendChild(el);
  setTimeout(() => dismissToast(el), 4000);
}

function dismissToast(el) {
  if (el.classList.contains("removing")) return;
  el.classList.add("removing");
  setTimeout(() => el.remove(), 200);
}

function fadeRemoveEl(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add("fading-out");
  setTimeout(() => el.remove(), 150);
}

function formatSize(bytes) {
  if (!bytes) return "—";
  const kb = bytes / 1024;
  return kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`;
}

// ─── Analytics Dashboard ──────────────────────────────────────────────────────

async function handleShowAnalytics() {
  try {
    const data = await getAnalyticsData(state.user.uid);
    showAnalyticsOverlay(data);
  } catch (e) {
    console.error(e);
    showToast("Failed to load analytics.", "error");
  }
}

function showAnalyticsOverlay(data) {
  // Remove if exists
  document.getElementById("analytics-overlay")?.remove();

  const docCapacity = 20;
  const chunkCapacity = 500;
  const chatCapacity = 50;
  const docPct = Math.min((data.docCount / docCapacity) * 100, 100);
  const chunkPct = Math.min((data.chunkCount / chunkCapacity) * 100, 100);
  const chatPct = Math.min((data.chatCount / chatCapacity) * 100, 100);

  const latestDocDateStr = data.latestDocDate
    ? new Date(data.latestDocDate).toLocaleDateString()
    : "—";

  document.body.insertAdjacentHTML("beforeend", `
    <div id="analytics-overlay" class="analytics-overlay">
      <div class="analytics-modal">
        <div class="analytics-header">
          <span>ANALYTICS DASHBOARD</span>
          <button id="analytics-close-btn" title="Close">✕</button>
        </div>
        <div class="analytics-body">
          <div class="analytics-grid">
            <div class="analytics-stat">
              <div class="analytics-stat-label">Documents</div>
              <div class="analytics-stat-value">${data.docCount}</div>
            </div>
            <div class="analytics-stat">
              <div class="analytics-stat-label">Chunks</div>
              <div class="analytics-stat-value">${data.chunkCount}</div>
            </div>
            <div class="analytics-stat">
              <div class="analytics-stat-label">Chats</div>
              <div class="analytics-stat-value">${data.chatCount}</div>
            </div>
            <div class="analytics-stat">
              <div class="analytics-stat-label">Messages</div>
              <div class="analytics-stat-value">${data.totalMessages}</div>
            </div>
          </div>

          <div class="analytics-section">
            <div class="analytics-section-title">Document Capacity</div>
            <div class="analytics-bar-row">
              <div class="analytics-bar-label">Docs</div>
              <div class="analytics-bar-track">
                <div class="analytics-bar-fill" style="width: ${docPct}%"></div>
              </div>
              <div class="analytics-bar-value">${data.docCount}/${docCapacity}</div>
            </div>
            <div class="analytics-bar-row">
              <div class="analytics-bar-label">Chunks</div>
              <div class="analytics-bar-track">
                <div class="analytics-bar-fill" style="width: ${chunkPct}%"></div>
              </div>
              <div class="analytics-bar-value">${data.chunkCount}/${chunkCapacity}</div>
            </div>
            <div class="analytics-bar-row">
              <div class="analytics-bar-label">Chats</div>
              <div class="analytics-bar-track">
                <div class="analytics-bar-fill" style="width: ${chatPct}%"></div>
              </div>
              <div class="analytics-bar-value">${data.chatCount}/${chatCapacity}</div>
            </div>
          </div>

          <div class="analytics-section">
            <div class="analytics-section-title">Usage Statistics</div>
            <div class="analytics-meta-row">
              <span class="analytics-meta-label">Most Queried Doc</span>
              <span class="analytics-meta-value">${data.mostQueriedDoc}</span>
            </div>
            <div class="analytics-meta-row">
              <span class="analytics-meta-label">Latest Document</span>
              <span class="analytics-meta-value">${data.latestDoc}</span>
            </div>
            <div class="analytics-meta-row">
              <span class="analytics-meta-label">Added On</span>
              <span class="analytics-meta-value">${latestDocDateStr}</span>
            </div>
            <div class="analytics-meta-row">
              <span class="analytics-meta-label">Total Sessions</span>
              <span class="analytics-meta-value">${data.chatCount}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `);

  // Attach close button handler
  document.getElementById("analytics-close-btn")?.addEventListener("click", () => {
    document.getElementById("analytics-overlay")?.remove();
  });

  // Close on outside click
  document.getElementById("analytics-overlay")?.addEventListener("click", (e) => {
    if (e.target.id === "analytics-overlay") {
      document.getElementById("analytics-overlay")?.remove();
    }
  });
}

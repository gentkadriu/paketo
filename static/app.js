let token = localStorage.getItem("posta_token");
let currentUser = null;
let currentBatchId = null;
let currentBatch = null;
let selectedDate = null;
let dateKind = "imported";
let selectedLeadIds = new Set();

const ORDER_ID_LENGTH = 14;
const ORDER_ID_PREFIX = "917";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const PHASE_LABELS = {
  linking: "Registered — enter IDs",
  sent: "Sent to courier",
  tracking: "AKS tracking active",
};

function showToast(msg, isError = false) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.toggle("error", isError);
  el.classList.remove("hidden");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.add("hidden"), 3500);
}

function validateOrderId(orderId) {
  if (!orderId) return null;
  if (!/^\d+$/.test(orderId)) {
    return `Order ID must contain digits only (exactly ${ORDER_ID_LENGTH} characters).`;
  }
  if (!orderId.startsWith(ORDER_ID_PREFIX)) {
    return `Order ID must start with ${ORDER_ID_PREFIX}.`;
  }
  if (orderId.length !== ORDER_ID_LENGTH) {
    return `Order ID must be exactly ${ORDER_ID_LENGTH} characters (e.g. 91766000346509).`;
  }
  return null;
}

function setOrderIdFieldState(input, state) {
  input.classList.remove("saved", "invalid");
  if (state === "saved") input.classList.add("saved");
  if (state === "invalid") input.classList.add("invalid");
}

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));

  if (res.status === 401) {
    logout();
    throw new Error("Session expired. Please log in again.");
  }
  if (!res.ok) throw new Error(data.detail || "Server error.");
  return data;
}

function showView(name) {
  $$(".page").forEach((p) => p.classList.remove("active"));
  $$(".nav-btn[data-view]").forEach((b) => b.classList.remove("active"));
  if (name !== "batch") {
    $(`#page-${name}`)?.classList.add("active");
    $(`.nav-btn[data-view="${name}"]`)?.classList.add("active");
  } else {
    $("#page-batch").classList.add("active");
  }
}

function showApp() {
  $("#view-auth").classList.add("hidden");
  $("#view-app").classList.remove("hidden");
}

function showAuth() {
  $("#view-auth").classList.remove("hidden");
  $("#view-app").classList.add("hidden");
}

function logout() {
  token = null;
  currentUser = null;
  localStorage.removeItem("posta_token");
  showAuth();
}

async function initApp() {
  showAuth();
  if (!token) return;

  try {
    currentUser = await api("/api/auth/me");
    $("#userGreeting").textContent = currentUser.name || currentUser.email;
    showApp();
    await loadDashboard();
    await loadStats();
  } catch {
    logout();
  }
}

// ── Auth ─────────────────────────────────────────────

$$(".auth-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    $$(".auth-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const isLogin = tab.dataset.tab === "login";
    $("#loginForm").classList.toggle("hidden", !isLogin);
    $("#registerForm").classList.toggle("hidden", isLogin);
  });
});

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const data = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: $("#loginEmail").value.trim(),
        password: $("#loginPassword").value,
      }),
    });
    token = data.token;
    localStorage.setItem("posta_token", token);
    currentUser = data.user;
    await initApp();
    showToast(`Welcome, ${data.user.name || data.user.email}!`);
  } catch (err) {
    showToast(err.message, true);
  }
});

$("#registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const data = await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email: $("#registerEmail").value.trim(),
        password: $("#registerPassword").value,
        name: $("#registerName").value.trim(),
      }),
    });
    token = data.token;
    localStorage.setItem("posta_token", token);
    currentUser = data.user;
    await initApp();
    showToast("Account created!");
  } catch (err) {
    showToast(err.message, true);
  }
});

$("#logoutBtn").addEventListener("click", logout);
$("#goHome").addEventListener("click", () => {
  showView("dashboard");
  loadDashboard();
});

$$(".nav-btn[data-view]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const view = btn.dataset.view;
    showView(view);
    if (view === "dashboard") loadDashboard();
    if (view === "stats") loadStats();
  });
});

// ── Dashboard ────────────────────────────────────────

$$(".seg").forEach((btn) => {
  btn.addEventListener("click", () => {
    $$(".seg").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    dateKind = btn.dataset.kind;
    selectedDate = null;
    loadDashboard();
  });
});

async function loadDashboard() {
  const dates = await api(`/api/dashboard/dates?kind=${dateKind}`);
  renderDateList(dates);

  const params = new URLSearchParams({ kind: dateKind });
  if (selectedDate) params.set("date", selectedDate);

  const batches = await api(`/api/dashboard/batches?${params}`);
  renderDashboardBatches(batches);
}

function renderDateList(dates) {
  const el = $("#dateList");
  if (!dates.length) {
    el.innerHTML = '<p class="empty-state">No batches yet.</p>';
    return;
  }

  const allBtn = `
    <div class="date-item ${!selectedDate ? "selected" : ""}" data-date="">
      All dates
    </div>`;

  el.innerHTML = allBtn + dates.map((d) => `
    <div class="date-item ${selectedDate === d.date ? "selected" : ""}" data-date="${d.date}">
      <span>${formatDate(d.date)}</span>
      <span class="date-count">${d.batch_count} batch${d.batch_count === 1 ? "" : "es"}</span>
    </div>
  `).join("");

  el.querySelectorAll(".date-item").forEach((item) => {
    item.addEventListener("click", () => {
      selectedDate = item.dataset.date || null;
      loadDashboard();
    });
  });
}

function batchStatusTag(status, sentAt) {
  if (status === "tracking") return '<span class="tag tracking">AKS tracking</span>';
  if (sentAt || status === "sent") return '<span class="tag sent">Sent to courier</span>';
  return '<span class="tag registered">Registered</span>';
}

function renderDashboardBatches(batches) {
  const title = selectedDate
    ? `Batches — ${formatDate(selectedDate)}`
    : "All batches";
  $("#batchListTitle").textContent = title;

  const el = $("#dashboardBatchList");
  if (!batches.length) {
    el.innerHTML = '<p class="empty-state">No batches for the selected day.</p>';
    return;
  }

  el.innerHTML = batches.map((b) => `
    <div class="batch-item" data-id="${b.id}">
      <div class="batch-item-title">${esc(b.name)}</div>
      <div class="batch-item-meta">
        Imported: ${formatDate(b.imported_date)}
        ${b.sent_date ? ` · Sent: ${formatDate(b.sent_date)}` : ""}
        · ${b.lead_count} orders · ${b.linked_count} IDs entered
      </div>
      <div class="batch-tags">${batchStatusTag(b.status, b.sent_at)}</div>
    </div>
  `).join("");

  el.querySelectorAll(".batch-item").forEach((item) => {
    item.addEventListener("click", () => openBatch(Number(item.dataset.id)));
  });
}

// ── Statistics ───────────────────────────────────────

async function loadStats() {
  const dates = await api("/api/dashboard/dates?kind=imported");
  const select = $("#statsDateFilter");
  const current = select.value;
  select.innerHTML = '<option value="">All dates</option>' +
    dates.map((d) => `<option value="${d.date}">${formatDate(d.date)}</option>`).join("");
  select.value = current;

  const params = new URLSearchParams();
  if (select.value) params.set("date", select.value);
  const stats = await api(`/api/statistics?${params}`);

  $("#statsSummary").innerHTML = stats.items.map((item) => `
    <div class="stat-card ${item.status}">
      <div class="stat-num">${item.count}</div>
      <div class="stat-label">${esc(item.label)}</div>
    </div>
  `).join("") || '<p class="empty-state">No data.</p>';

  $("#statsBars").innerHTML = `
    <h3>Status breakdown (${stats.total} total)</h3>
    ${stats.items.filter((i) => i.count > 0).map((item) => `
      <div class="bar-row">
        <div class="bar-label">
          <span>${esc(item.label)}</span>
          <span>${item.count} (${item.percent}%)</span>
        </div>
        <div class="bar-track">
          <div class="bar-fill ${item.status}" style="width:${item.percent}%"></div>
        </div>
      </div>
    `).join("")}
  `;
}

$("#statsDateFilter").addEventListener("change", loadStats);

// ── Batch detail ─────────────────────────────────────

async function openBatch(id) {
  currentBatchId = id;
  selectedLeadIds.clear();
  currentBatch = await api(`/api/batches/${id}`);
  showView("batch");
  renderBatchHeader();
  renderLinkStep();
  renderTrackingStep();
  updateLinkProgress();
  updateBulkToolbar();
}

function renderBatchHeader() {
  if (!currentBatch) return;
  $("#batchNameEdit").value = currentBatch.name;
  $("#batchMeta").textContent =
    `Imported: ${formatDate(currentBatch.imported_date)}` +
    (currentBatch.sent_date ? ` · Sent: ${formatDate(currentBatch.sent_date)}` : "") +
    ` · ${currentBatch.lead_count} orders`;

  $("#batchPhase").textContent = PHASE_LABELS[currentBatch.status] || currentBatch.status;

  const allLinked = currentBatch.linked_count >= currentBatch.lead_count;
  const isSent = !!currentBatch.sent_at;
  const isTracking = currentBatch.status === "tracking";

  $("#goTrackingBtn").disabled = !isSent || !allLinked || isTracking;
  $("#goTrackingBtn").textContent = isTracking ? "Tracking active ✓" : "Start tracking";
}

function getSelectedLeadIds() {
  return [...selectedLeadIds];
}

function updateBulkToolbar() {
  const count = selectedLeadIds.size;
  const total = currentBatch?.leads?.length || 0;
  $("#selectedCount").textContent = `${count} selected`;
  $("#bulkApplyStatusBtn").disabled = count === 0;
  $("#bulkMarkSentBtn").disabled = count === 0;
  $("#bulkDeleteBtn").disabled = count === 0;

  const selectAll = $("#selectAllLeads");
  if (selectAll) {
    selectAll.checked = total > 0 && count === total;
    selectAll.indeterminate = count > 0 && count < total;
  }
}

async function runBulkAction(action, status = null) {
  const leadIds = getSelectedLeadIds();
  if (!leadIds.length || !currentBatchId) return;

  if (action === "delete") {
    const names = currentBatch.leads
      .filter((l) => leadIds.includes(l.id))
      .map((l) => l.full_name)
      .slice(0, 3)
      .join(", ");
    const more = leadIds.length > 3 ? ` and ${leadIds.length - 3} more` : "";
    if (!confirm(`Delete ${leadIds.length} lead(s)?\n${names}${more}`)) return;
  }

  try {
    const body = { lead_ids: leadIds, action };
    if (status) body.status = status;
    currentBatch = await api(`/api/batches/${currentBatchId}/leads/bulk`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    selectedLeadIds.clear();
    renderBatchHeader();
    renderLinkStep();
    renderTrackingStep();
    updateLinkProgress();
    updateBulkToolbar();

    const messages = {
      delete: `Deleted ${leadIds.length} lead(s).`,
      mark_sent: `Marked ${leadIds.length} lead(s) as sent to courier.`,
      set_status: `Updated status for ${leadIds.length} lead(s).`,
    };
    showToast(messages[action] || "Bulk action completed.");
  } catch (err) {
    showToast(err.message, true);
  }
}

function goToBatchStep(step) {
  $$(".batch-panel").forEach((p) => p.classList.remove("active"));
  $$(".batch-steps .step-btn").forEach((b) => b.classList.remove("active"));
  $(`#step-${step}`).classList.add("active");
  $(`.batch-steps .step-btn[data-step="${step}"]`).classList.add("active");
}

function updateLinkProgress() {
  if (!currentBatch) return;
  const total = currentBatch.leads.length;
  const linked = currentBatch.leads.filter((l) => l.order_id).length;
  $("#linkProgress").textContent = `${linked} / ${total} IDs entered`;
  renderBatchHeader();
}

function renderLinkStep() {
  const container = $("#leadList");
  if (!currentBatch?.leads?.length) {
    container.innerHTML = '<p class="empty-state">No leads.</p>';
    return;
  }

  container.innerHTML = currentBatch.leads.map((lead) => `
    <div class="lead-row ${selectedLeadIds.has(lead.id) ? "selected" : ""}" data-id="${lead.id}">
      <div class="lead-check">
        <input type="checkbox" class="lead-select" data-lead-id="${lead.id}"
          ${selectedLeadIds.has(lead.id) ? "checked" : ""} />
      </div>
      <div class="lead-left">
        <button class="lead-toggle" type="button">
          <span class="lead-num">${lead.sort_order}.</span>
          <span class="lead-name">${esc(lead.full_name)}</span>
          <span class="status-pill ${lead.lifecycle_status || "registered"}">${esc(lead.lifecycle_label || "Registered")}</span>
          <span class="lead-badge ${lead.order_id ? "done" : ""}">${lead.order_id ? "ID saved" : "no ID"}</span>
          <span class="chevron">▶</span>
        </button>
        <div class="lead-details">
          <div>${esc(lead.street)}</div>
          <div>${esc(lead.city)}${lead.postal_code ? " " + esc(lead.postal_code) : ""}</div>
          <div>${esc(lead.phone)}</div>
        </div>
      </div>
      <div class="lead-right">
        <input type="text" class="order-id-input" data-lead-id="${lead.id}"
          inputmode="numeric" pattern="[0-9]*"
          placeholder="91766000346509" value="${esc(lead.order_id || "")}" maxlength="${ORDER_ID_LENGTH}" />
        <button type="button" class="btn primary save-id-btn" data-lead-id="${lead.id}">Save</button>
      </div>
    </div>
  `).join("");

  container.querySelectorAll(".lead-toggle").forEach((btn) => {
    btn.addEventListener("click", () => btn.closest(".lead-row").classList.toggle("open"));
  });

  container.querySelectorAll(".lead-select").forEach((box) => {
    box.addEventListener("change", () => {
      const id = Number(box.dataset.leadId);
      if (box.checked) selectedLeadIds.add(id);
      else selectedLeadIds.delete(id);
      box.closest(".lead-row").classList.toggle("selected", box.checked);
      updateBulkToolbar();
    });
  });

  container.querySelectorAll(".order-id-input").forEach((input) => {
    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, "").slice(0, ORDER_ID_LENGTH);
      setOrderIdFieldState(input, null);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        saveOrderId(input);
      }
    });
  });

  container.querySelectorAll(".save-id-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = btn.closest(".lead-right").querySelector(".order-id-input");
      saveOrderId(input);
    });
  });
}

async function saveOrderId(input) {
  const leadId = Number(input.dataset.leadId);
  const orderId = input.value.trim();
  const error = validateOrderId(orderId);

  if (error) {
    setOrderIdFieldState(input, "invalid");
    showToast(error, true);
    return;
  }

  const btn = input.closest(".lead-right").querySelector(".save-id-btn");
  btn.disabled = true;

  try {
    const updated = await api(`/api/leads/${leadId}/order-id`, {
      method: "PATCH",
      body: JSON.stringify({ order_id: orderId }),
    });
    const lead = currentBatch.leads.find((l) => l.id === leadId);
    if (lead) Object.assign(lead, updated);

    setOrderIdFieldState(input, orderId ? "saved" : null);
    const row = input.closest(".lead-row");
    const badge = row.querySelector(".lead-badge");
    badge.textContent = orderId ? "ID saved" : "no ID";
    badge.classList.toggle("done", !!orderId);

    currentBatch.linked_count = currentBatch.leads.filter((l) => l.order_id).length;
    updateLinkProgress();
    if (orderId) showToast("Order ID saved.");

    const rows = [...$("#leadList").querySelectorAll(".order-id-input")];
    const idx = rows.indexOf(input);
    if (orderId && idx >= 0 && idx < rows.length - 1) rows[idx + 1].focus();
  } catch (err) {
    setOrderIdFieldState(input, "invalid");
    showToast(err.message, true);
  } finally {
    btn.disabled = false;
  }
}

function renderTrackingStep() {
  const container = $("#trackingList");
  if (!currentBatch?.leads?.length) {
    container.innerHTML = '<p class="empty-state">No data.</p>';
    return;
  }

  container.innerHTML = currentBatch.leads.map((lead) => {
    const cls = lead.lifecycle_status || "unknown";
    const historyRows = (lead.tracking_history || []).map((h) =>
      `<tr><td>${esc(h.status)}</td><td>${esc(h.location)}</td><td>${esc(h.time)}</td></tr>`
    ).join("");

    return `
      <div class="track-card">
        <div class="track-card-header">
          <div>
            <div class="track-name">${lead.sort_order}. ${esc(lead.full_name)}</div>
            <div class="track-id">${esc(lead.order_id || "—")}</div>
          </div>
          <span class="status-pill ${cls}">${esc(lead.lifecycle_label || lead.tracking_status || "Registered")}</span>
        </div>
        ${lead.tracking_location ? `<div class="track-meta">${esc(lead.tracking_location)} · ${esc(lead.tracking_updated_at || "")}</div>` : ""}
        ${lead.tracking_status ? `<div class="track-meta">AKS: ${esc(lead.tracking_status)}</div>` : ""}
        ${historyRows ? `<details class="track-history"><summary>History</summary>
          <table><thead><tr><th>Status</th><th>Location</th><th>Time</th></tr></thead>
          <tbody>${historyRows}</tbody></table></details>` : ""}
      </div>`;
  }).join("");
}

$("#createBatchBtn").addEventListener("click", async () => {
  const name = $("#batchName").value.trim();
  const leadsText = $("#leadsText").value.trim();
  if (!name) return showToast("Enter a batch name.", true);
  if (!leadsText) return showToast("Enter at least one lead.", true);

  try {
    const batch = await api("/api/batches", {
      method: "POST",
      body: JSON.stringify({ name, leads_text: leadsText }),
    });
    showToast(`Created batch "${name}" with ${batch.lead_count} leads.`);
    $("#batchName").value = "";
    $("#leadsText").value = "";
    await openBatch(batch.id);
  } catch (err) {
    showToast(err.message, true);
  }
});

$("#saveBatchNameBtn").addEventListener("click", async () => {
  if (!currentBatchId) return;
  const name = $("#batchNameEdit").value.trim();
  if (!name) return showToast("Batch name cannot be empty.", true);
  try {
    const updated = await api(`/api/batches/${currentBatchId}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
    currentBatch.name = updated.name;
    renderBatchHeader();
    showToast("Batch name saved.");
  } catch (err) {
    showToast(err.message, true);
  }
});

$("#selectAllLeads").addEventListener("change", (e) => {
  if (!currentBatch?.leads) return;
  selectedLeadIds.clear();
  if (e.target.checked) {
    currentBatch.leads.forEach((l) => selectedLeadIds.add(l.id));
  }
  renderLinkStep();
  updateBulkToolbar();
});

$("#bulkApplyStatusBtn").addEventListener("click", () => {
  runBulkAction("set_status", $("#bulkStatusSelect").value);
});

$("#bulkMarkSentBtn").addEventListener("click", () => {
  runBulkAction("mark_sent");
});

$("#bulkDeleteBtn").addEventListener("click", () => {
  runBulkAction("delete");
});

$("#markSentBtn")?.remove();

$("#goTrackingBtn").addEventListener("click", async () => {
  if (!currentBatchId) return;
  try {
    await api(`/api/batches/${currentBatchId}/start-tracking`, { method: "POST" });
    currentBatch = await api(`/api/batches/${currentBatchId}`);
    renderBatchHeader();
    goToBatchStep("track");
    showToast("AKS tracking enabled — checks run automatically every 2 hours.");
  } catch (err) {
    showToast(err.message, true);
  }
});

$("#refreshTrackingBtn").addEventListener("click", async () => {
  if (!currentBatchId) return;
  $("#refreshTrackingBtn").disabled = true;
  $("#refreshTrackingBtn").textContent = "Checking…";
  try {
    const data = await api(`/api/batches/${currentBatchId}/refresh-tracking`, {
      method: "POST",
    });
    currentBatch = await api(`/api/batches/${currentBatchId}`);
    renderTrackingStep();
    const failed = data.results.filter((r) => !r.ok).length;
    showToast(
      failed ? `${failed} package(s) could not be updated.` : "All statuses refreshed automatically.",
      !!failed
    );
  } catch (err) {
    showToast(err.message, true);
  } finally {
    $("#refreshTrackingBtn").disabled = false;
    $("#refreshTrackingBtn").textContent = "Refresh now";
  }
});

$("#backToDashboard").addEventListener("click", () => {
  showView("dashboard");
  loadDashboard();
});

$$(".batch-steps .step-btn").forEach((btn) => {
  btn.addEventListener("click", () => goToBatchStep(btn.dataset.step));
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}

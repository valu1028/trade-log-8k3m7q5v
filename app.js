import {
  createBackup,
  deleteTagAndDetach,
  getAllRecords,
  getAllTags,
  getSetting,
  initializeDatabase,
  putRecord,
  putSetting,
  putTag,
  removeRecord,
  restoreBackup
} from "./db.js";

const TAG_COLORS = ["#2563eb", "#7957c8", "#16845b", "#d97706", "#d44747", "#0f8191"];

const elements = {
  appHeader: document.querySelector(".app-header"),
  headerTagFilterRow: document.querySelector("#tag-filter-row"),
  calendarMonthTitle: document.querySelector("#calendar-month-title"),
  balanceMonthTitle: document.querySelector("#balance-month-title"),
  summaryMonth: document.querySelector("#summary-month"),
  summaryFilterLabel: document.querySelector("#summary-filter-label"),
  summaryNet: document.querySelector("#summary-net"),
  summaryInvestment: document.querySelector("#summary-investment"),
  summaryReturn: document.querySelector("#summary-return"),
  tagSummaryGrid: document.querySelector("#tag-summary-grid"),
  calendarMiniSummaryLabel: document.querySelector("#calendar-mini-summary-label"),
  calendarMiniSummaryValue: document.querySelector("#calendar-mini-summary-value"),
  tagFilterRows: document.querySelectorAll(".tag-filter-row"),
  calendarGrid: document.querySelector("#calendar-grid"),
  selectedDateTitle: document.querySelector("#selected-date-title"),
  selectedDateTotal: document.querySelector("#selected-date-total"),
  selectedDateRecords: document.querySelector("#selected-date-records"),
  historyList: document.querySelector("#history-list"),
  analysisPeriod: document.querySelector("#analysis-period"),
  analysisOverview: document.querySelector("#analysis-overview"),
  analysisTagList: document.querySelector("#analysis-tag-list"),
  recordModal: document.querySelector("#record-modal"),
  recordForm: document.querySelector("#record-form"),
  recordModalTitle: document.querySelector("#record-modal-title"),
  recordId: document.querySelector("#record-id"),
  recordDate: document.querySelector("#record-date"),
  recordTitle: document.querySelector("#record-title"),
  recordInvestment: document.querySelector("#record-investment"),
  recordReturn: document.querySelector("#record-return"),
  recordNote: document.querySelector("#record-note"),
  recordNetPreview: document.querySelector("#record-net-preview"),
  recordTagOptions: document.querySelector("#record-tag-options"),
  recordFormError: document.querySelector("#record-form-error"),
  saveRecord: document.querySelector("#save-record"),
  deleteRecord: document.querySelector("#delete-record"),
  settingsModal: document.querySelector("#settings-modal"),
  settingsTagList: document.querySelector("#settings-tag-list"),
  addTagForm: document.querySelector("#add-tag-form"),
  newTagName: document.querySelector("#new-tag-name"),
  tagFormError: document.querySelector("#tag-form-error"),
  storageStatus: document.querySelector("#storage-status"),
  lastBackupLabel: document.querySelector("#last-backup-label"),
  importBackup: document.querySelector("#import-backup"),
  toast: document.querySelector("#toast")
};

const today = new Date();

const state = {
  currentMonth: new Date(today.getFullYear(), today.getMonth(), 1),
  selectedDate: toDateKey(today),
  selectedTagId: "all",
  activeView: "calendar",
  records: [],
  tags: [],
  allTags: [],
  lastTagIds: ["tag-scalping"],
  toastTimer: null
};

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromKey(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function firstDayOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function dateKeyForMonth(date, day = 1) {
  return toDateKey(new Date(date.getFullYear(), date.getMonth(), day));
}

function monthRecords(records = state.records) {
  const prefix = `${state.currentMonth.getFullYear()}-${String(state.currentMonth.getMonth() + 1).padStart(2, "0")}-`;
  return records.filter((record) => record.date.startsWith(prefix));
}

function applyTagFilter(records) {
  if (state.selectedTagId === "all") return records;
  return records.filter((record) => record.tagIds.includes(state.selectedTagId));
}

function recordNet(record) {
  return Number(record.returnAmount) - Number(record.investment);
}

function summarize(records) {
  return records.reduce((summary, record) => {
    const net = recordNet(record);
    summary.investment += Number(record.investment);
    summary.returnAmount += Number(record.returnAmount);
    summary.net += net;
    summary.count += 1;
    if (net > 0) summary.wins += 1;
    if (net < 0) summary.losses += 1;
    if (net === 0) summary.draws += 1;
    return summary;
  }, { investment: 0, returnAmount: 0, net: 0, count: 0, wins: 0, losses: 0, draws: 0 });
}

function createId(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatYen(value) {
  return `${Math.round(value).toLocaleString("ja-JP")}円`;
}

function formatSignedYen(value) {
  if (value > 0) return `＋${formatYen(value)}`;
  if (value < 0) return `－${formatYen(Math.abs(value))}`;
  return "0円";
}

function formatLossYen(value) {
  const amount = Math.round(Math.abs(value));
  return amount > 0 ? `－${formatYen(amount)}` : "0円";
}

function formatProfitYen(value) {
  const amount = Math.round(Math.abs(value));
  return amount > 0 ? `＋${formatYen(amount)}` : "0円";
}

function formatCalendarSigned(value) {
  const formatted = Math.round(Math.abs(value)).toLocaleString("ja-JP");
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return "0";
}

function formatMonth(date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

function formatDisplayDate(dateKey, includeYear = false) {
  const date = dateFromKey(dateKey);
  const weekday = ["日", "月", "火", "水", "木", "金", "土"][date.getDay()];
  if (includeYear) return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日（${weekday}）`;
  return `${date.getMonth() + 1}月${date.getDate()}日（${weekday}）`;
}

function setSignedClass(element, value) {
  element.classList.toggle("is-positive", value > 0);
  element.classList.toggle("is-negative", value < 0);
  element.classList.toggle("is-zero", value === 0);
}

function safeTagColor(tag) {
  return /^#[0-9a-f]{6}$/i.test(tag?.color || "") ? tag.color : "#2563eb";
}

function findTag(tagId) {
  return state.allTags.find((tag) => tag.id === tagId);
}

function showToast(message) {
  clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  state.toastTimer = setTimeout(() => elements.toast.classList.remove("is-visible"), 2600);
}

function createEmptyState(title, description) {
  const container = document.createElement("div");
  container.className = "empty-state";
  const strong = document.createElement("strong");
  const paragraph = document.createElement("p");
  strong.textContent = title;
  paragraph.textContent = description;
  container.append(strong, paragraph);
  return container;
}

function renderTagFilters() {
  const filterItems = [{ id: "all", name: "すべて" }, ...state.tags];

  elements.tagFilterRows.forEach((row) => {
    row.replaceChildren();
    filterItems.forEach((tag) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tag-chip";
      button.textContent = tag.name;
      button.setAttribute("aria-pressed", String(state.selectedTagId === tag.id));
      button.addEventListener("click", () => {
        state.selectedTagId = tag.id;
        renderTagFilters();
        renderCalendarArea();
      });
      row.append(button);
    });
  });
}

function renderSummary() {
  const allMonthRecords = monthRecords();
  const visibleRecords = applyTagFilter(allMonthRecords);
  const summary = summarize(visibleRecords);
  const selectedTag = state.tags.find((tag) => tag.id === state.selectedTagId);

  elements.balanceMonthTitle.textContent = formatMonth(state.currentMonth);
  elements.calendarMiniSummaryLabel.textContent = `${state.currentMonth.getMonth() + 1}月収支`;
  elements.calendarMiniSummaryValue.textContent = formatSignedYen(summary.net);
  elements.summaryMonth.textContent = `${state.currentMonth.getMonth() + 1}月の収支`;
  elements.summaryFilterLabel.textContent = selectedTag?.name || "すべて";
  elements.summaryNet.textContent = formatSignedYen(summary.net);
  elements.summaryInvestment.textContent = formatLossYen(summary.investment);
  elements.summaryReturn.textContent = formatProfitYen(summary.returnAmount);
  setSignedClass(elements.summaryNet, summary.net);
  setSignedClass(elements.calendarMiniSummaryValue, summary.net);
  setSignedClass(elements.summaryInvestment, -summary.investment);
  setSignedClass(elements.summaryReturn, summary.returnAmount);

  elements.tagSummaryGrid.replaceChildren();
  state.tags.forEach((tag) => {
    const tagRecords = allMonthRecords.filter((record) => record.tagIds.includes(tag.id));
    const item = document.createElement("div");
    item.className = "tag-summary-item";

    const label = document.createElement("span");
    label.className = "tag-summary-label";
    label.style.setProperty("--tag-color", safeTagColor(tag));
    label.textContent = tag.name;

    const value = document.createElement("strong");
    const net = summarize(tagRecords).net;
    value.textContent = formatSignedYen(net);
    setSignedClass(value, net);

    item.append(label, value);
    elements.tagSummaryGrid.append(item);
  });
}

function renderCalendar() {
  const year = state.currentMonth.getFullYear();
  const month = state.currentMonth.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const numberOfDays = new Date(year, month + 1, 0).getDate();
  const cellCount = Math.ceil((firstWeekday + numberOfDays) / 7) * 7;
  const visibleMonthRecords = applyTagFilter(monthRecords());
  const dailyTotals = new Map();

  visibleMonthRecords.forEach((record) => {
    dailyTotals.set(record.date, (dailyTotals.get(record.date) || 0) + recordNet(record));
  });

  elements.calendarMonthTitle.textContent = formatMonth(state.currentMonth);
  elements.calendarGrid.replaceChildren();

  for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
    const day = cellIndex - firstWeekday + 1;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "calendar-day";

    if (day < 1 || day > numberOfDays) {
      button.classList.add("is-outside-month");
      button.tabIndex = -1;
      button.setAttribute("aria-hidden", "true");
      elements.calendarGrid.append(button);
      continue;
    }

    const dateKey = dateKeyForMonth(state.currentMonth, day);
    const total = dailyTotals.get(dateKey) || 0;
    const dayNumber = document.createElement("span");
    dayNumber.className = "day-number";
    dayNumber.textContent = String(day);
    button.append(dayNumber);

    if (dailyTotals.has(dateKey)) {
      const dayNet = document.createElement("span");
      dayNet.className = "day-net";
      dayNet.textContent = formatCalendarSigned(total);
      setSignedClass(dayNet, total);
      button.append(dayNet);
    }

    if (dateKey === state.selectedDate) button.classList.add("is-selected");
    if (dateKey === toDateKey(today)) button.classList.add("is-today");
    button.setAttribute("aria-label", `${formatDisplayDate(dateKey)}、収支${formatSignedYen(total)}`);
    button.addEventListener("click", () => {
      state.selectedDate = dateKey;
      renderCalendar();
      renderSelectedDate();
    });
    elements.calendarGrid.append(button);
  }
}

function createRecordCard(record, { showDate = true } = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "record-card";
  button.setAttribute("aria-label", `${formatDisplayDate(record.date)}の記録を編集`);
  button.addEventListener("click", () => openRecordModal({ record }));

  const main = document.createElement("div");
  main.className = "record-main";
  const titleRow = document.createElement("div");
  titleRow.className = "record-title-row";
  const title = document.createElement("p");
  title.className = "record-title";
  title.textContent = record.title || "収支記録";
  titleRow.append(title);

  if (showDate) {
    const date = document.createElement("span");
    date.className = "record-date";
    date.textContent = formatDisplayDate(record.date);
    titleRow.append(date);
  }

  const tags = document.createElement("div");
  tags.className = "record-tags";
  record.tagIds.forEach((tagId) => {
    const tag = findTag(tagId);
    if (!tag) return;
    const span = document.createElement("span");
    span.className = "mini-tag";
    span.style.setProperty("--tag-color", safeTagColor(tag));
    span.textContent = `#${tag.name}`;
    tags.append(span);
  });
  main.append(titleRow, tags);

  const amounts = document.createElement("div");
  amounts.className = "record-amounts";
  const net = document.createElement("strong");
  net.className = "record-net";
  const netAmount = recordNet(record);
  net.textContent = formatSignedYen(netAmount);
  setSignedClass(net, netAmount);
  const raw = document.createElement("span");
  raw.className = "record-raw";
  raw.textContent = `損 ${formatLossYen(record.investment)} / 利 ${formatProfitYen(record.returnAmount)}`;
  amounts.append(net, raw);

  button.append(main, amounts);
  return button;
}

function renderSelectedDate() {
  const records = applyTagFilter(state.records)
    .filter((record) => record.date === state.selectedDate)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const summary = summarize(records);

  elements.selectedDateTitle.textContent = formatDisplayDate(state.selectedDate, true);
  elements.selectedDateTotal.textContent = formatSignedYen(summary.net);
  setSignedClass(elements.selectedDateTotal, summary.net);
  elements.selectedDateRecords.replaceChildren();

  if (records.length === 0) {
    elements.selectedDateRecords.append(createEmptyState("記録はありません", "＋ボタンからこの日の収支を追加できます。"));
    return;
  }

  records.forEach((record) => elements.selectedDateRecords.append(createRecordCard(record, { showDate: false })));
}

function renderCalendarArea() {
  renderSummary();
  renderCalendar();
  renderSelectedDate();
}

function renderHistory() {
  const records = [...state.records].sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt));
  elements.historyList.replaceChildren();
  if (records.length === 0) {
    elements.historyList.append(createEmptyState("まだ記録がありません", "カレンダーの＋ボタンから最初の収支を追加しましょう。"));
    return;
  }

  const monthlyRecords = new Map();
  records.forEach((record) => {
    const monthKey = record.date.slice(0, 7);
    if (!monthlyRecords.has(monthKey)) monthlyRecords.set(monthKey, []);
    monthlyRecords.get(monthKey).push(record);
  });

  monthlyRecords.forEach((recordsForMonth, monthKey) => {
    const [year, month] = monthKey.split("-").map(Number);
    const summary = summarize(recordsForMonth);
    const section = document.createElement("section");
    section.className = "history-month-section";

    const heading = document.createElement("h3");
    heading.id = `history-month-${monthKey}`;
    heading.textContent = `${year}年${month}月`;
    section.setAttribute("aria-labelledby", heading.id);

    const metrics = document.createElement("div");
    metrics.className = "history-month-summary";
    metrics.append(
      createMetricCard("記録", `${summary.count}件`),
      createMetricCard("損失", formatLossYen(summary.investment), -summary.investment),
      createMetricCard("利益", formatProfitYen(summary.returnAmount), summary.returnAmount),
      createMetricCard("収支", formatSignedYen(summary.net), summary.net)
    );

    const recordList = document.createElement("div");
    recordList.className = "record-list history-month-records";
    recordsForMonth.forEach((record) => recordList.append(createRecordCard(record)));

    section.append(heading, metrics, recordList);
    elements.historyList.append(section);
  });
}

function createMetricCard(label, value, signedValue = null) {
  const card = document.createElement("div");
  card.className = "metric-card";
  const labelElement = document.createElement("span");
  const valueElement = document.createElement("strong");
  labelElement.textContent = label;
  valueElement.textContent = value;
  if (signedValue !== null) setSignedClass(valueElement, signedValue);
  card.append(labelElement, valueElement);
  return card;
}

function renderAnalysis() {
  const records = elements.analysisPeriod.value === "all" ? state.records : monthRecords();
  const summary = summarize(records);
  const decidedTrades = summary.wins + summary.losses;
  const winRate = decidedTrades ? (summary.wins / decidedTrades) * 100 : 0;
  const recoveryRate = summary.investment ? (summary.returnAmount / summary.investment) * 100 : 0;

  elements.analysisOverview.replaceChildren(
    createMetricCard("収支", formatSignedYen(summary.net), summary.net),
    createMetricCard("勝率", `${winRate.toFixed(1)}%`),
    createMetricCard("利益率", `${recoveryRate.toFixed(1)}%`)
  );

  elements.analysisTagList.replaceChildren();
  state.allTags.forEach((tag) => {
    const tagRecords = records.filter((record) => record.tagIds.includes(tag.id));
    const tagSummary = summarize(tagRecords);
    const tagDecidedTrades = tagSummary.wins + tagSummary.losses;
    const tagWinRate = tagDecidedTrades ? (tagSummary.wins / tagDecidedTrades) * 100 : 0;
    const tagRecoveryRate = tagSummary.investment ? (tagSummary.returnAmount / tagSummary.investment) * 100 : 0;

    const card = document.createElement("div");
    card.className = "analysis-tag-card";
    const heading = document.createElement("div");
    heading.className = "analysis-tag-heading";
    const name = document.createElement("span");
    name.className = "analysis-tag-name";
    name.style.setProperty("--tag-color", safeTagColor(tag));
    name.textContent = tag.archived ? `${tag.name}（非表示）` : tag.name;
    const value = document.createElement("strong");
    value.textContent = formatSignedYen(tagSummary.net);
    setSignedClass(value, tagSummary.net);
    heading.append(name, value);

    const metrics = document.createElement("div");
    metrics.className = "analysis-tag-metrics";
    metrics.append(
      document.createTextNode(`${tagSummary.count}件`),
      document.createTextNode(`勝率 ${tagWinRate.toFixed(1)}%`),
      document.createTextNode(`利益率 ${tagRecoveryRate.toFixed(1)}%`)
    );
    card.append(heading, metrics);
    elements.analysisTagList.append(card);
  });

  if (state.allTags.length === 0) {
    elements.analysisTagList.append(createEmptyState("タグがありません", "設定からタグを追加できます。"));
  }
}

function renderSettingsTags() {
  elements.settingsTagList.replaceChildren();
  state.allTags.forEach((tag) => {
    const row = document.createElement("div");
    row.className = "settings-tag-item";
    const name = document.createElement("span");
    name.className = "settings-tag-name";
    name.style.setProperty("--tag-color", safeTagColor(tag));
    name.textContent = tag.archived ? `${tag.name}（非表示）` : tag.name;
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "archive-tag-button";
    toggle.textContent = tag.archived ? "復元" : "非表示";
    toggle.addEventListener("click", async () => {
      await putTag({ ...tag, archived: !tag.archived, updatedAt: new Date().toISOString() });
      await refreshData();
      showToast(tag.archived ? "タグを復元しました。" : "タグを非表示にしました。");
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "delete-tag-button";
    deleteButton.textContent = "削除";
    deleteButton.addEventListener("click", async () => {
      const affectedCount = state.records.filter((record) => record.tagIds.includes(tag.id)).length;
      const message = affectedCount > 0
        ? `「${tag.name}」を削除し、${affectedCount}件の記録からこのタグを外しますか？\n収支記録自体は削除されません。`
        : `「${tag.name}」を完全に削除しますか？`;
      if (!window.confirm(message)) return;

      await deleteTagAndDetach(tag.id);
      state.lastTagIds = state.lastTagIds.filter((tagId) => tagId !== tag.id);
      await refreshData();
      showToast(`「${tag.name}」を削除しました。`);
    });

    const actions = document.createElement("div");
    actions.className = "settings-tag-actions";
    actions.append(toggle, deleteButton);
    row.append(name, actions);
    elements.settingsTagList.append(row);
  });
}

function renderAll() {
  if (state.selectedTagId !== "all" && !state.tags.some((tag) => tag.id === state.selectedTagId)) {
    state.selectedTagId = "all";
  }
  renderTagFilters();
  renderCalendarArea();
  renderHistory();
  renderAnalysis();
  renderSettingsTags();
}

function openModal(modal) {
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("has-modal");
}

function closeModal(modal) {
  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");
  if (!document.querySelector(".modal-backdrop.is-open")) document.body.classList.remove("has-modal");
}

function renderRecordTagOptions(selectedTagIds) {
  elements.recordTagOptions.replaceChildren();
  const selected = new Set(selectedTagIds);
  const availableTags = [...state.tags];

  selected.forEach((tagId) => {
    const tag = findTag(tagId);
    if (tag && !availableTags.some((item) => item.id === tag.id)) availableTags.push(tag);
  });

  availableTags.forEach((tag) => {
    const label = document.createElement("label");
    label.className = "tag-checkbox";
    label.style.setProperty("--tag-color", safeTagColor(tag));
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "record-tags";
    input.value = tag.id;
    input.checked = selected.has(tag.id);
    const text = document.createElement("span");
    text.textContent = tag.archived ? `${tag.name}（非表示）` : tag.name;
    label.append(input, text);
    elements.recordTagOptions.append(label);
  });

  if (availableTags.length === 0) {
    const message = document.createElement("p");
    message.className = "helper-text";
    message.textContent = "タグなしでも保存できます。必要になったら設定から追加してください。";
    elements.recordTagOptions.append(message);
  }
}

function openRecordModal({ date = state.selectedDate, record = null } = {}) {
  elements.recordForm.reset();
  elements.recordFormError.textContent = "";
  elements.recordId.value = record?.id || "";
  elements.recordDate.value = record?.date || date;
  elements.recordTitle.value = record?.title || "";
  elements.recordInvestment.value = record ? String(record.investment) : "";
  elements.recordReturn.value = record ? String(record.returnAmount) : "";
  elements.recordNote.value = record?.note || "";
  elements.recordModalTitle.textContent = record ? "収支を編集" : "収支を追加";
  elements.deleteRecord.hidden = !record;

  let selectedTagIds;
  if (record) {
    selectedTagIds = record.tagIds;
  } else {
    selectedTagIds = state.lastTagIds.filter((tagId) => state.tags.some((tag) => tag.id === tagId));
    if (selectedTagIds.length === 0) selectedTagIds = state.tags.slice(0, 1).map((tag) => tag.id);
  }
  renderRecordTagOptions(selectedTagIds);
  updateNetPreview();
  openModal(elements.recordModal);
  window.setTimeout(() => elements.recordInvestment.focus(), 220);
}

function updateNetPreview() {
  const investment = Number(elements.recordInvestment.value || 0);
  const returnAmount = Number(elements.recordReturn.value || 0);
  const net = returnAmount - investment;
  const value = elements.recordNetPreview.querySelector("strong");
  value.textContent = formatSignedYen(net);
  setSignedClass(elements.recordNetPreview, net);
}

async function handleRecordSubmit(event) {
  event.preventDefault();
  elements.recordFormError.textContent = "";
  const investmentInput = elements.recordInvestment.value.trim();
  const returnInput = elements.recordReturn.value.trim();
  const investment = investmentInput === "" ? 0 : Number(investmentInput);
  const returnAmount = returnInput === "" ? 0 : Number(returnInput);
  const tagIds = [...elements.recordTagOptions.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value);

  if (!elements.recordDate.value) {
    elements.recordFormError.textContent = "日付を入力してください。";
    return;
  }
  if (investmentInput === "" && returnInput === "") {
    elements.recordFormError.textContent = "損失または利益のどちらかを入力してください。";
    return;
  }
  if (!Number.isFinite(investment) || !Number.isFinite(returnAmount) || investment < 0 || returnAmount < 0) {
    elements.recordFormError.textContent = "損失と利益は0円以上で入力してください。";
    return;
  }
  const existingRecord = state.records.find((record) => record.id === elements.recordId.value);
  const now = new Date().toISOString();
  const record = {
    id: existingRecord?.id || elements.recordId.value || createId("record"),
    date: elements.recordDate.value,
    title: elements.recordTitle.value.trim(),
    investment: Math.round(investment),
    returnAmount: Math.round(returnAmount),
    tagIds,
    note: elements.recordNote.value.trim(),
    createdAt: existingRecord?.createdAt || now,
    updatedAt: now
  };

  elements.saveRecord.disabled = true;
  try {
    await putRecord(record);
    await putSetting("lastTagIds", tagIds);
    state.lastTagIds = tagIds;
    elements.recordId.value = record.id;
    state.selectedDate = record.date;
    state.currentMonth = firstDayOfMonth(dateFromKey(record.date));
    await refreshData();
    closeModal(elements.recordModal);
    switchView("calendar");
    showToast(existingRecord ? "記録を更新しました。" : "記録を保存しました。");
  } catch (error) {
    console.error(error);
    elements.recordFormError.textContent = "保存できませんでした。空き容量を確認してもう一度お試しください。";
  } finally {
    elements.saveRecord.disabled = false;
  }
}

async function handleDeleteRecord() {
  const recordId = elements.recordId.value;
  if (!recordId) return;
  const confirmed = window.confirm("この収支記録を削除しますか？");
  if (!confirmed) return;
  await removeRecord(recordId);
  await refreshData();
  closeModal(elements.recordModal);
  showToast("記録を削除しました。");
}

function switchView(viewName) {
  state.activeView = viewName;
  const calendarIsActive = viewName === "calendar";
  elements.headerTagFilterRow.hidden = !calendarIsActive;
  elements.appHeader.classList.toggle("is-settings-only", !calendarIsActive);
  document.querySelectorAll(".view").forEach((view) => {
    const active = view.dataset.view === viewName;
    view.hidden = !active;
    view.classList.toggle("is-active", active);
  });
  document.querySelectorAll(".nav-button").forEach((button) => {
    const active = button.dataset.targetView === viewName;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function addTag(event) {
  event.preventDefault();
  elements.tagFormError.textContent = "";
  const name = elements.newTagName.value.trim();
  if (!name) return;
  if (state.allTags.some((tag) => tag.name.toLocaleLowerCase("ja") === name.toLocaleLowerCase("ja"))) {
    elements.tagFormError.textContent = "同じ名前のタグがすでにあります。";
    return;
  }

  const tag = {
    id: createId("tag"),
    name,
    color: TAG_COLORS[state.allTags.length % TAG_COLORS.length],
    archived: false,
    createdAt: new Date().toISOString()
  };
  await putTag(tag);
  elements.addTagForm.reset();
  await refreshData();
  showToast(`「${name}」を追加しました。`);
}

async function updateStorageStatus() {
  if (!navigator.storage) {
    elements.storageStatus.textContent = "このブラウザでは保存状態を取得できません。定期的にバックアップしてください。";
    return;
  }

  try {
    let persisted = await navigator.storage.persisted();
    if (!persisted && navigator.storage.persist) persisted = await navigator.storage.persist();
    elements.storageStatus.textContent = persisted
      ? "端末内の永続ストレージを使用しています。念のため定期的に書き出してください。"
      : "端末内に保存しています。消失対策として定期的に書き出してください。";
  } catch {
    elements.storageStatus.textContent = "端末内に保存しています。消失対策として定期的に書き出してください。";
  }
}

async function renderLastBackup() {
  const lastBackupAt = await getSetting("lastBackupAt");
  if (!lastBackupAt) {
    elements.lastBackupLabel.textContent = "バックアップ履歴はありません。";
    return;
  }
  const formatted = new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" }).format(new Date(lastBackupAt));
  elements.lastBackupLabel.textContent = `最終バックアップ：${formatted}`;
}

async function exportBackupFile() {
  const backup = await createBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `trade-log-backup-${toDateKey(new Date())}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  await putSetting("lastBackupAt", new Date().toISOString());
  await renderLastBackup();
  showToast("バックアップを書き出しました。");
}

async function importBackupFile(event) {
  const [file] = event.target.files;
  event.target.value = "";
  if (!file) return;

  try {
    const backup = JSON.parse(await file.text());
    const confirmed = window.confirm("現在のデータをバックアップ内容で置き換えますか？");
    if (!confirmed) return;
    await restoreBackup(backup);
    await putSetting("lastBackupAt", new Date().toISOString());
    await refreshData();
    await renderLastBackup();
    showToast("バックアップを読み込みました。");
  } catch (error) {
    console.error(error);
    showToast(error.message || "バックアップを読み込めませんでした。");
  }
}

async function refreshData() {
  const [records, allTags] = await Promise.all([
    getAllRecords(),
    getAllTags({ includeArchived: true })
  ]);
  state.records = records;
  state.allTags = allTags;
  state.tags = allTags.filter((tag) => !tag.archived);
  renderAll();
}

function bindEvents() {
  const showPreviousMonth = () => {
    state.currentMonth = new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth() - 1, 1);
    state.selectedDate = dateKeyForMonth(state.currentMonth, 1);
    renderCalendarArea();
  };

  const showNextMonth = () => {
    state.currentMonth = new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth() + 1, 1);
    state.selectedDate = dateKeyForMonth(state.currentMonth, 1);
    renderCalendarArea();
  };

  const showCurrentMonth = () => {
    state.currentMonth = firstDayOfMonth(today);
    state.selectedDate = toDateKey(today);
    renderCalendarArea();
  };

  document.querySelector("#previous-month").addEventListener("click", showPreviousMonth);
  document.querySelector("#balance-previous-month").addEventListener("click", showPreviousMonth);
  document.querySelector("#next-month").addEventListener("click", showNextMonth);
  document.querySelector("#balance-next-month").addEventListener("click", showNextMonth);
  document.querySelector("#go-today").addEventListener("click", showCurrentMonth);
  document.querySelector("#balance-go-today").addEventListener("click", showCurrentMonth);

  document.querySelector("#floating-add").addEventListener("click", () => openRecordModal());
  document.querySelector("#add-for-selected-date").addEventListener("click", () => openRecordModal({ date: state.selectedDate }));
  document.querySelector("#close-record-modal").addEventListener("click", () => closeModal(elements.recordModal));
  document.querySelector("#open-settings").addEventListener("click", async () => {
    openModal(elements.settingsModal);
    await Promise.all([updateStorageStatus(), renderLastBackup()]);
  });
  document.querySelector("#close-settings-modal").addEventListener("click", () => closeModal(elements.settingsModal));

  elements.recordModal.addEventListener("click", (event) => {
    if (event.target === elements.recordModal) closeModal(elements.recordModal);
  });
  elements.settingsModal.addEventListener("click", (event) => {
    if (event.target === elements.settingsModal) closeModal(elements.settingsModal);
  });

  elements.recordForm.addEventListener("submit", handleRecordSubmit);
  elements.deleteRecord.addEventListener("click", handleDeleteRecord);
  elements.recordInvestment.addEventListener("input", updateNetPreview);
  elements.recordReturn.addEventListener("input", updateNetPreview);
  elements.addTagForm.addEventListener("submit", addTag);
  document.querySelector("#export-backup").addEventListener("click", exportBackupFile);
  elements.importBackup.addEventListener("change", importBackupFile);
  elements.analysisPeriod.addEventListener("change", renderAnalysis);

  document.querySelectorAll(".nav-button").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.targetView));
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (elements.recordModal.classList.contains("is-open")) closeModal(elements.recordModal);
    else if (elements.settingsModal.classList.contains("is-open")) closeModal(elements.settingsModal);
  });
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  try {
    await navigator.serviceWorker.register("./service-worker.js", { scope: "./" });
  } catch (error) {
    console.warn("Service Workerを登録できませんでした。", error);
  }
}

async function startApp() {
  try {
    await initializeDatabase();
    const lastTagIds = await getSetting("lastTagIds");
    if (Array.isArray(lastTagIds) && lastTagIds.length) state.lastTagIds = lastTagIds;
    bindEvents();
    await refreshData();
    registerServiceWorker();
  } catch (error) {
    console.error(error);
    document.querySelector("main").replaceChildren(createEmptyState("アプリを起動できませんでした", "Safariのプライベートブラウズを解除して、ページを再読み込みしてください。"));
  }
}

startApp();

/* =========================================================
 * Calendar View – ArtStart + Copydesk deadline calendar
 * ======================================================= */

(function () {
  "use strict";

  // ---- State ----
  let currentView = "week"; // "week" | "month"
  let currentDate = new Date(); // The reference date for navigation
  let calendarData = []; // Combined ArtStart + Copydesk items

  // ---- DOM References ----
  let panelEl = null;
  let triggerEl = null;
  let contentEl = null;

  // ---- Initialization ----

  function init() {
    panelEl = document.getElementById("ascend-calendar-panel");
    triggerEl = document.getElementById("ascend-calendar-trigger");
    contentEl = document.getElementById("ascend-calendar-content");

    if (!panelEl || !triggerEl) {
      console.warn("[Calendar] Missing panel or trigger element");
      return;
    }

    // Toggle panel on trigger click
    triggerEl.addEventListener("click", togglePanel);

    console.log("[Calendar] Initialized");
  }

  // ---- Toggle Panel ----

  function togglePanel(evt) {
    if (evt) {
      evt.preventDefault();
      evt.stopPropagation();
    }

    const isExpanded = panelEl.getAttribute("aria-expanded") === "true";

    if (isExpanded) {
      closePanel();
    } else {
      openPanel();
    }
  }

  function openPanel() {
    panelEl.setAttribute("aria-expanded", "true");
    triggerEl.setAttribute("aria-expanded", "true");

    // Fetch data and render
    fetchCalendarData().then(() => {
      render();
    });

    console.log("[Calendar] Panel opened");
  }

  function closePanel() {
    panelEl.setAttribute("aria-expanded", "false");
    triggerEl.setAttribute("aria-expanded", "false");
    console.log("[Calendar] Panel closed");
  }

  // ---- Data Fetching ----

  /**
   * Fetch ArtStart and Copydesk jobs, combine into calendarData.
   * Each item has: { type, title, date, jobKey, meta }
   */
  async function fetchCalendarData() {
    // TODO: Integrate with existing JSONP calls or refactor to fetch here
    // For now, use placeholder data to scaffold the UI

    calendarData = getPlaceholderData();
    console.log("[Calendar] Fetched data:", calendarData.length, "items");
  }

  function getPlaceholderData() {
    const today = new Date();
    const items = [];

    // Generate some placeholder items for the current week
    for (let i = -2; i <= 5; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);

      if (i === 0) {
        items.push({
          type: "artstart",
          title: "Spring Campaign Hero Banner",
          date: new Date(d),
          jobKey: "AS-001",
          meta: "Materials due",
        });
      }
      if (i === 1) {
        items.push({
          type: "copydesk",
          title: "Product Launch Press Release",
          date: new Date(d),
          jobKey: "CD-042",
          meta: "Cutoff",
        });
      }
      if (i === 3) {
        items.push({
          type: "artstart",
          title: "Trade Show Booth Graphics",
          date: new Date(d),
          jobKey: "AS-002",
          meta: "Materials due",
        });
        items.push({
          type: "copydesk",
          title: "Q2 Newsletter Copy",
          date: new Date(d),
          jobKey: "CD-043",
          meta: "Cutoff",
        });
      }
      if (i === 5) {
        items.push({
          type: "artstart",
          title: "Social Media Ad Set",
          date: new Date(d),
          jobKey: "AS-003",
          meta: "Materials due",
        });
      }
    }

    return items;
  }

  // ---- Rendering ----

  function render() {
    if (!contentEl) return;

    const html = `
      <div class="ascend-calendar-header">
        <div class="ascend-calendar-nav">
          <button type="button" class="ascend-calendar-nav-btn" data-calendar-nav="prev">&larr;</button>
          <span class="ascend-calendar-period" id="ascend-calendar-period">${getPeriodLabel()}</span>
          <button type="button" class="ascend-calendar-nav-btn" data-calendar-nav="next">&rarr;</button>
        </div>
        <div class="ascend-calendar-view-toggle">
          <button type="button" class="ascend-calendar-view-btn" data-calendar-view="week" aria-pressed="${currentView === "week"}">Week</button>
          <button type="button" class="ascend-calendar-view-btn" data-calendar-view="month" aria-pressed="${currentView === "month"}">Month</button>
        </div>
      </div>
      <div class="ascend-calendar-body" id="ascend-calendar-body">
        ${currentView === "week" ? renderWeekView() : renderMonthView()}
      </div>
    `;

    contentEl.innerHTML = html;

    // Bind event listeners
    bindCalendarEvents();
  }

  function bindCalendarEvents() {
    // Navigation
    contentEl.querySelectorAll("[data-calendar-nav]").forEach((btn) => {
      btn.addEventListener("click", (evt) => {
        const dir = evt.currentTarget.dataset.calendarNav;
        navigate(dir);
      });
    });

    // View toggle
    contentEl.querySelectorAll("[data-calendar-view]").forEach((btn) => {
      btn.addEventListener("click", (evt) => {
        const view = evt.currentTarget.dataset.calendarView;
        setView(view);
      });
    });

    // Item clicks
    contentEl.querySelectorAll("[data-calendar-item]").forEach((el) => {
      el.addEventListener("click", (evt) => {
        const key = evt.currentTarget.dataset.calendarItem;
        handleItemClick(key);
      });
    });
  }

  function getPeriodLabel() {
    const opts = { month: "long", year: "numeric" };
    if (currentView === "week") {
      const start = getWeekStart(currentDate);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);

      const startMonth = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const endMonth = end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      return `${startMonth} – ${endMonth}`;
    } else {
      return currentDate.toLocaleDateString("en-US", opts);
    }
  }

  // ---- Week View ----

  function renderWeekView() {
    const weekStart = getWeekStart(currentDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let html = '<div class="ascend-calendar-week">';

    for (let i = 0; i < 7; i++) {
      const day = new Date(weekStart);
      day.setDate(day.getDate() + i);
      day.setHours(0, 0, 0, 0);

      const isToday = day.getTime() === today.getTime();
      const dayItems = getItemsForDate(day);

      html += `
        <div class="ascend-calendar-day ${isToday ? "ascend-calendar-day--today" : ""}">
          <div class="ascend-calendar-day-label">
            <div class="ascend-calendar-day-label-date">${day.getDate()}</div>
            <div class="ascend-calendar-day-label-weekday">${day.toLocaleDateString("en-US", { weekday: "short" })}</div>
          </div>
          <div class="ascend-calendar-day-items">
            ${dayItems.length > 0 ? dayItems.map(renderWeekItem).join("") : '<div class="ascend-calendar-day-empty">No deadlines</div>'}
          </div>
        </div>
      `;
    }

    html += "</div>";
    return html;
  }

  function renderWeekItem(item) {
    return `
      <div class="ascend-calendar-item" data-calendar-item="${item.jobKey}">
        <span class="ascend-calendar-item-badge ascend-calendar-item-badge--${item.type}">${item.type === "artstart" ? "Art" : "Copy"}</span>
        <span class="ascend-calendar-item-title">${escapeHtml(item.title)}</span>
        <span class="ascend-calendar-item-meta">${escapeHtml(item.meta)}</span>
      </div>
    `;
  }

  // ---- Month View ----

  function renderMonthView() {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startOffset = firstDay.getDay(); // 0 = Sunday

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    let html = '<div class="ascend-calendar-month">';

    // Header row
    weekdays.forEach((wd) => {
      html += `<div class="ascend-calendar-month-header">${wd}</div>`;
    });

    // Day cells
    const totalCells = Math.ceil((startOffset + lastDay.getDate()) / 7) * 7;

    for (let i = 0; i < totalCells; i++) {
      const dayNum = i - startOffset + 1;
      const isOutside = dayNum < 1 || dayNum > lastDay.getDate();
      const cellDate = new Date(year, month, dayNum);
      cellDate.setHours(0, 0, 0, 0);
      const isToday = !isOutside && cellDate.getTime() === today.getTime();
      const dayItems = isOutside ? [] : getItemsForDate(cellDate);

      html += `
        <div class="ascend-calendar-month-cell ${isOutside ? "ascend-calendar-month-cell--outside" : ""} ${isToday ? "ascend-calendar-month-cell--today" : ""}">
          <div class="ascend-calendar-month-date">${isOutside ? "" : dayNum}</div>
          <div class="ascend-calendar-month-dots">
            ${dayItems.map((item) => `<div class="ascend-calendar-month-dot ascend-calendar-month-dot--${item.type}"></div>`).join("")}
          </div>
        </div>
      `;
    }

    html += "</div>";
    return html;
  }

  // ---- Navigation ----

  function navigate(direction) {
    if (currentView === "week") {
      const delta = direction === "prev" ? -7 : 7;
      currentDate.setDate(currentDate.getDate() + delta);
    } else {
      const delta = direction === "prev" ? -1 : 1;
      currentDate.setMonth(currentDate.getMonth() + delta);
    }
    render();
  }

  function setView(view) {
    if (view === currentView) return;
    currentView = view;
    render();
  }

  // ---- Item Interaction ----

  function handleItemClick(jobKey) {
    // TODO: Open the job in appropriate app (ArtStart or Copydesk)
    console.log("[Calendar] Item clicked:", jobKey);
  }

  // ---- Helpers ----

  function getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay();
    d.setDate(d.getDate() - day);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function getItemsForDate(date) {
    const dateStr = date.toDateString();
    return calendarData.filter((item) => item.date.toDateString() === dateStr);
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ---- Expose init ----

  window.AscendCalendar = { init };

  // Auto-init on DOMContentLoaded
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

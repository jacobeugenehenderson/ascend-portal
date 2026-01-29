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
   * Each item has: { type, title, date, jobKey, meta, openUrl }
   */
  async function fetchCalendarData() {
    const config = window.AscendConfig;
    if (!config) {
      console.warn("[Calendar] AscendConfig not available, using placeholder data");
      calendarData = getPlaceholderData();
      return;
    }

    const session = config.loadSession();
    if (!session || !session.userEmail) {
      console.warn("[Calendar] No session, using placeholder data");
      calendarData = getPlaceholderData();
      return;
    }

    // Fetch both in parallel
    const [artStartJobs, copydeskJobs] = await Promise.all([
      fetchArtStartJobs(config, session.userEmail),
      fetchCopydeskJobs(config, session.userEmail)
    ]);

    // Combine and sort by date
    calendarData = [...artStartJobs, ...copydeskJobs].sort((a, b) => a.date - b.date);

    console.log("[Calendar] Fetched data:", calendarData.length, "items");
  }

  function fetchArtStartJobs(config, userEmail) {
    return new Promise((resolve) => {
      const callbackName = "ascendCalendarArtStartCallback_" + Date.now();

      window[callbackName] = function (payload) {
        try {
          const jobs = payload && payload.jobs ? payload.jobs : [];
          const items = [];

          for (const job of jobs) {
            if (!job.MaterialsDueDate) continue;

            const date = parseDate(job.MaterialsDueDate);
            if (!date) continue;

            const title = job.NordsonJobId || job.AscendJobId || "Untitled";
            const subtitle = [job.PublicationName, job.DeliverableType]
              .filter(Boolean)
              .join(" · ");

            const openUrlRaw = config.ARTSTART_JOB_URL + "?jobid=" + encodeURIComponent(job.AscendJobId || "");
            const openUrl = config.buildUrlWithUser(openUrlRaw);

            items.push({
              type: "artstart",
              title: title,
              subtitle: subtitle,
              date: date,
              jobKey: job.AscendJobId || "",
              meta: "Materials due",
              openUrl: openUrl,
              rawJob: job
            });
          }

          resolve(items);
        } catch (e) {
          console.warn("[Calendar] Error parsing ArtStart jobs:", e);
          resolve([]);
        } finally {
          delete window[callbackName];
        }
      };

      const url = new URL(config.ARTSTART_API_BASE);
      url.searchParams.set("action", "listArtStartJobsForUser");
      url.searchParams.set("user_email", userEmail);
      url.searchParams.set("limit", "100");
      url.searchParams.set("callback", callbackName);

      const script = document.createElement("script");
      script.src = url.toString();
      script.async = true;
      script.onerror = () => {
        console.warn("[Calendar] Failed to load ArtStart jobs");
        delete window[callbackName];
        resolve([]);
      };
      document.body.appendChild(script);
    });
  }

  function fetchCopydeskJobs(config, userEmail) {
    return new Promise((resolve) => {
      const callbackName = "ascendCalendarCopydeskCallback_" + Date.now();

      window[callbackName] = function (payload) {
        try {
          const jobs = payload && payload.jobs ? payload.jobs : [];
          const items = [];

          for (const job of jobs) {
            if (!job.Cutoff) continue;

            const date = parseDate(job.Cutoff);
            if (!date) continue;

            const title = job.JobName || job.Name || job.Title || job.DocumentName || "Untitled";
            const subtitle = [job.PublicationName, job.SoldAs]
              .filter(Boolean)
              .join(" · ");

            const openUrlRaw = config.COPYDESK_JOB_URL + "?jobid=" + encodeURIComponent(job.JobId || "");
            const openUrl = config.buildUrlWithUser(openUrlRaw);

            items.push({
              type: "copydesk",
              title: title,
              subtitle: subtitle,
              date: date,
              jobKey: job.JobId || "",
              meta: "Cutoff",
              openUrl: openUrl,
              rawJob: job
            });
          }

          resolve(items);
        } catch (e) {
          console.warn("[Calendar] Error parsing Copydesk jobs:", e);
          resolve([]);
        } finally {
          delete window[callbackName];
        }
      };

      const url = new URL(config.COPYDESK_API_BASE);
      url.searchParams.set("action", "listCopydeskJobsForUser");
      url.searchParams.set("user_email", userEmail);
      url.searchParams.set("limit", "100");
      url.searchParams.set("callback", callbackName);

      const script = document.createElement("script");
      script.src = url.toString();
      script.async = true;
      script.onerror = () => {
        console.warn("[Calendar] Failed to load Copydesk jobs");
        delete window[callbackName];
        resolve([]);
      };
      document.body.appendChild(script);
    });
  }

  /**
   * Parse various date formats into a Date object.
   * Handles: "2026-01-28", "1/28/2026", "Jan 28, 2026", ISO strings, etc.
   */
  function parseDate(val) {
    if (!val) return null;
    if (val instanceof Date) return val;

    // Try direct parse
    let d = new Date(val);
    if (!isNaN(d.getTime())) {
      // Normalize to midnight local time
      return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }

    // Try MM/DD/YYYY
    const slashMatch = String(val).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slashMatch) {
      d = new Date(parseInt(slashMatch[3]), parseInt(slashMatch[1]) - 1, parseInt(slashMatch[2]));
      if (!isNaN(d.getTime())) return d;
    }

    return null;
  }

  function getPlaceholderData() {
    const today = new Date();
    const items = [];

    // Generate some placeholder items for the current week with varying stages
    for (let i = -2; i <= 5; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);

      if (i === 0) {
        items.push({
          type: "artstart",
          title: "Spring Campaign Hero Banner",
          subtitle: "Print · Full Page",
          date: new Date(d),
          jobKey: "AS-001",
          meta: "Materials due",
          openUrl: "#",
          rawJob: { TouchpointMeetingDate: "2026-01-15" } // Stage 2
        });
      }
      if (i === 1) {
        items.push({
          type: "copydesk",
          title: "Product Launch Press Release",
          subtitle: "PR · English",
          date: new Date(d),
          jobKey: "CD-042",
          meta: "Cutoff",
          openUrl: "#",
          rawJob: { Edited: true } // Stage 2
        });
      }
      if (i === 3) {
        items.push({
          type: "artstart",
          title: "Trade Show Booth Graphics",
          subtitle: "Event · Booth",
          date: new Date(d),
          jobKey: "AS-002",
          meta: "Materials due",
          openUrl: "#",
          rawJob: {} // Stage 1
        });
        items.push({
          type: "copydesk",
          title: "Q2 Newsletter Copy",
          subtitle: "Newsletter · Multi-language",
          date: new Date(d),
          jobKey: "CD-043",
          meta: "Cutoff",
          openUrl: "#",
          rawJob: {} // Stage 1
        });
      }
      if (i === 5) {
        items.push({
          type: "artstart",
          title: "Social Media Ad Set",
          subtitle: "Digital · Social",
          date: new Date(d),
          jobKey: "AS-003",
          meta: "Materials due",
          openUrl: "#",
          rawJob: { TouchpointMeetingDate: "2026-01-20" } // Stage 2
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

      const hasItems = dayItems.length > 0;
      html += `
        <div class="ascend-calendar-day ${isToday ? "ascend-calendar-day--today" : ""} ${!hasItems ? "ascend-calendar-day--empty" : ""}">
          <div class="ascend-calendar-day-label">
            <div class="ascend-calendar-day-label-date">${day.getDate()}</div>
            <div class="ascend-calendar-day-label-weekday">${day.toLocaleDateString("en-US", { weekday: "short" })}</div>
          </div>
          ${hasItems ? `<div class="ascend-calendar-day-drawer">${dayItems.map(renderWeekItem).join("")}</div>` : ""}
        </div>
      `;
    }

    html += "</div>";
    return html;
  }

  function renderWeekItem(item) {
    // Calculate stage using exposed functions
    const config = window.AscendConfig;
    let stage = 1;
    if (config && item.rawJob) {
      if (item.type === "artstart" && config.artStartStageForJob) {
        stage = config.artStartStageForJob(item.rawJob);
      } else if (item.type === "copydesk" && config.copydeskStageForJob) {
        stage = config.copydeskStageForJob(item.rawJob);
      }
    }

    return `
      <button class="ascend-calendar-item ascend-calendar-item--${item.type}" data-calendar-item="${escapeAttr(item.jobKey)}">
        <div class="ascend-calendar-item-progress" data-stage="${stage}">
          <div class="ascend-calendar-item-dot" data-step="1"></div>
          <div class="ascend-calendar-item-dot" data-step="2"></div>
          <div class="ascend-calendar-item-dot" data-step="3"></div>
        </div>
        <div class="ascend-calendar-item-stack">
          <div class="ascend-calendar-item-title">${escapeHtml(item.title)}</div>
          <div class="ascend-calendar-item-meta">${escapeHtml(item.subtitle || item.meta)}</div>
        </div>
      </button>
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
            ${dayItems.map((item) => `<div class="ascend-calendar-month-dot ascend-calendar-month-dot--${item.type}" title="${escapeAttr(item.title)}"></div>`).join("")}
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
    const item = calendarData.find((i) => i.jobKey === jobKey);
    if (item && item.openUrl) {
      window.open(item.openUrl, "_blank", "noopener");
    }
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

  function escapeAttr(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
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

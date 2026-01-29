/* =========================================================
 * Calendar View – ArtStart + Copydesk deadline calendar
 * ======================================================= */

(function () {
  "use strict";

  // ---- State ----
  let currentView = "week"; // "week" | "month"
  let currentDate = new Date(); // The reference date for navigation
  let calendarData = []; // Combined ArtStart + Copydesk + show deadline items (single-date)
  let showsData = []; // Shows with date spans (ShowStartDate → ShowEndDate)
  let deadlineRangesData = []; // Deadline date ranges (rendered as stripes like shows)

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

    // Fetch all in parallel
    const [artStartJobs, copydeskJobs, showsResult] = await Promise.all([
      fetchArtStartJobs(config, session.userEmail),
      fetchCopydeskJobs(config, session.userEmail),
      fetchShows(config)
    ]);

    // Extract shows, deadlines, and ranges
    showsData = showsResult.shows;
    deadlineRangesData = showsResult.ranges;
    const showDeadlines = showsResult.deadlines;

    // Combine single-date items and sort by date
    calendarData = [...artStartJobs, ...copydeskJobs, ...showDeadlines].sort((a, b) => a.date - b.date);

    console.log("[Calendar] Fetched data:", calendarData.length, "items,", showsData.length, "shows");
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

  function fetchShows(config) {
    return new Promise((resolve) => {
      const callbackName = "ascendCalendarShowsCallback_" + Date.now();

      window[callbackName] = function (payload) {
        try {
          const shows = payload && payload.shows ? payload.shows : [];
          const showItems = [];
          const deadlineItems = [];
          const rangeItems = [];

          for (const show of shows) {
            const startDate = parseDate(show.ShowStartDate);
            const endDate = parseDate(show.ShowEndDate);
            if (!startDate) continue;

            const showItem = {
              type: "show",
              showId: show.ShowId || "",
              name: show.Name || "Untitled Show",
              location: show.Location || "",
              startDate: startDate,
              endDate: endDate || startDate,
              lob: show.LOB || "",
              theme: show.Theme || "",
              rawShow: show
            };
            showItems.push(showItem);

            // Parse Deadlines column: "Name1|Date1,Name2|Date2,..." or "Name|StartDate~EndDate" for ranges
            if (show.Deadlines) {
              const pairs = show.Deadlines.split(",").map(s => s.trim()).filter(Boolean);
              for (const pair of pairs) {
                const [name, dateStr] = pair.split("|").map(s => s.trim());
                if (!name || !dateStr) continue;

                // Check for date range (using ~ as separator)
                if (dateStr.includes("~")) {
                  const [startStr, endStr] = dateStr.split("~").map(s => s.trim());
                  const startDate = parseDate(startStr);
                  const endDate = parseDate(endStr);
                  if (!startDate || !endDate) continue;

                  // Store as a range item (rendered as stripe)
                  rangeItems.push({
                    type: "deadlinerange",
                    title: name,
                    startDate: startDate,
                    endDate: endDate,
                    showId: show.ShowId || "",
                    showName: show.Name || "Untitled Show",
                    rawShow: show
                  });
                } else {
                  // Single date deadline
                  const date = parseDate(dateStr);
                  if (!date) continue;

                  deadlineItems.push({
                    type: "showdeadline",
                    title: name,
                    date: date,
                    jobKey: `${show.ShowId}-${name}-${dateStr}`,
                    meta: show.Name || "Show deadline",
                    showId: show.ShowId || "",
                    showName: show.Name || "Untitled Show",
                    rawShow: show
                  });
                }
              }
            }
          }

          resolve({ shows: showItems, deadlines: deadlineItems, ranges: rangeItems });
        } catch (e) {
          console.warn("[Calendar] Error parsing Shows:", e);
          resolve({ shows: [], deadlines: [], ranges: [] });
        } finally {
          delete window[callbackName];
        }
      };

      const url = new URL(config.ARTSTART_API_BASE);
      url.searchParams.set("action", "listShows");
      url.searchParams.set("limit", "50");
      url.searchParams.set("callback", callbackName);

      const script = document.createElement("script");
      script.src = url.toString();
      script.async = true;
      script.onerror = () => {
        console.warn("[Calendar] Failed to load Shows");
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

    // Show stripe clicks
    contentEl.querySelectorAll("[data-show-id]").forEach((el) => {
      el.addEventListener("click", (evt) => {
        evt.stopPropagation();
        const showId = evt.currentTarget.dataset.showId;
        handleShowClick(showId);
      });
    });

    // Deadline range stripe clicks
    contentEl.querySelectorAll("[data-deadline-range]").forEach((el) => {
      el.addEventListener("click", (evt) => {
        evt.stopPropagation();
        const rangeKey = evt.currentTarget.dataset.deadlineRange;
        handleDeadlineRangeClick(rangeKey);
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
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Find shows and deadline ranges that overlap this week
    const weekShows = getShowsForWeek(weekStart, weekEnd);
    const weekDeadlineRanges = getDeadlineRangesForWeek(weekStart, weekEnd);
    const hasStripes = weekShows.length > 0 || weekDeadlineRanges.length > 0;

    let html = `<div class="ascend-calendar-week ${hasStripes ? '' : 'ascend-calendar-week--no-shows'}">`;

    // Render each day's components directly into the grid
    for (let i = 0; i < 7; i++) {
      const day = new Date(weekStart);
      day.setDate(day.getDate() + i);
      day.setHours(0, 0, 0, 0);

      const isToday = day.getTime() === today.getTime();
      const dayItems = getItemsForDate(day);
      const hasItems = dayItems.length > 0;

      // Day label (column 1)
      html += `
        <div class="ascend-calendar-day-label ${isToday ? 'ascend-calendar-day-label--today' : ''} ${!hasItems ? 'ascend-calendar-day-label--empty' : ''}">
          <div class="ascend-calendar-day-label-date">${day.getDate()}</div>
          <div class="ascend-calendar-day-label-weekday">${day.toLocaleDateString("en-US", { weekday: "short" })}</div>
        </div>
      `;

      // Day drawer (column 3)
      if (hasItems) {
        html += `<div class="ascend-calendar-day-drawer">${dayItems.map(renderWeekItem).join("")}</div>`;
      } else {
        // Empty placeholder to maintain grid structure
        html += `<div class="ascend-calendar-day-empty"></div>`;
      }
    }

    // Stripes layer (column 2) - renders after days to appear on top visually
    if (hasStripes) {
      html += '<div class="ascend-calendar-show-layer">';
      html += weekShows.map((show) => renderWeekShowStripe(show, weekStart, weekEnd)).join("");
      html += weekDeadlineRanges.map((range) => renderWeekDeadlineRangeStripe(range, weekStart, weekEnd)).join("");
      html += '</div>';
    }

    html += "</div>";
    return html;
  }

  function getShowsForWeek(weekStart, weekEnd) {
    return showsData.filter((show) => {
      return show.startDate <= weekEnd && show.endDate >= weekStart;
    });
  }

  function getDeadlineRangesForWeek(weekStart, weekEnd) {
    return deadlineRangesData.filter((range) => {
      return range.startDate <= weekEnd && range.endDate >= weekStart;
    });
  }

  function renderWeekDeadlineRangeStripe(range, weekStart, weekEnd) {
    // Calculate which days of the week this range spans
    const rangeStartInWeek = range.startDate < weekStart ? weekStart : range.startDate;
    const rangeEndInWeek = range.endDate > weekEnd ? weekEnd : range.endDate;

    const startDayIndex = Math.floor((rangeStartInWeek - weekStart) / (1000 * 60 * 60 * 24));
    const endDayIndex = Math.floor((rangeEndInWeek - weekStart) / (1000 * 60 * 60 * 24));
    const daysInThisWeek = endDayIndex - startDayIndex + 1;

    const title = `${range.title} · ${range.showName}`;

    return `
      <div class="ascend-calendar-show-stripe ascend-calendar-show-stripe--vertical ascend-calendar-show-stripe--deadline"
           data-deadline-range="${escapeAttr(range.showId + '-' + range.title)}"
           style="--show-start-day: ${startDayIndex}; --show-span-days: ${daysInThisWeek};"
           title="${escapeAttr(title)}">
      </div>
    `;
  }

  function renderWeekShowStripe(show, weekStart, weekEnd) {
    // Calculate which days of the week this show spans
    const showStartInWeek = show.startDate < weekStart ? weekStart : show.startDate;
    const showEndInWeek = show.endDate > weekEnd ? weekEnd : show.endDate;

    const startDayIndex = Math.floor((showStartInWeek - weekStart) / (1000 * 60 * 60 * 24));
    const endDayIndex = Math.floor((showEndInWeek - weekStart) / (1000 * 60 * 60 * 24));

    // Calculate gradient position for visual continuity
    const totalShowDays = Math.floor((show.endDate - show.startDate) / (1000 * 60 * 60 * 24)) + 1;
    const daysBeforeThisWeek = Math.floor((showStartInWeek - show.startDate) / (1000 * 60 * 60 * 24));
    const daysInThisWeek = endDayIndex - startDayIndex + 1;

    // Calculate the portion of the gradient to show (0 = bottom/orange, 1 = top/blue)
    const gradientStart = daysBeforeThisWeek / totalShowDays;
    const gradientEnd = (daysBeforeThisWeek + daysInThisWeek) / totalShowDays;

    // Generate gradient with interpolated colors for this portion
    const gradient = generateGradientSlice(gradientStart, gradientEnd, 'vertical');

    const title = `${show.name}${show.location ? " · " + show.location : ""}`;

    return `
      <div class="ascend-calendar-show-stripe ascend-calendar-show-stripe--vertical"
           data-show-id="${escapeAttr(show.showId)}"
           style="--show-start-day: ${startDayIndex}; --show-span-days: ${daysInThisWeek}; background: ${gradient};"
           title="${escapeAttr(title)}">
      </div>
    `;
  }

  /**
   * Generate a gradient that represents a slice of the full show gradient.
   * Full gradient: orange (0%) -> teal (50%) -> blue (100%)
   * @param {number} start - Start position (0-1)
   * @param {number} end - End position (0-1)
   * @param {string} direction - 'vertical' or 'horizontal'
   */
  function generateGradientSlice(start, end, direction) {
    // Color stops: orange at 0, teal at 0.5, blue at 1
    const colors = [
      { pos: 0, r: 230, g: 149, b: 106 },    // orange (#e6956a)
      { pos: 0.5, r: 111, g: 185, b: 173 },  // teal (#6fb9ad)
      { pos: 1, r: 123, g: 156, b: 214 }     // blue (#7b9cd6)
    ];

    // Interpolate color at a position
    function colorAt(pos) {
      if (pos <= 0) return colors[0];
      if (pos >= 1) return colors[colors.length - 1];

      for (let i = 0; i < colors.length - 1; i++) {
        if (pos >= colors[i].pos && pos <= colors[i + 1].pos) {
          const t = (pos - colors[i].pos) / (colors[i + 1].pos - colors[i].pos);
          return {
            r: Math.round(colors[i].r + t * (colors[i + 1].r - colors[i].r)),
            g: Math.round(colors[i].g + t * (colors[i + 1].g - colors[i].g)),
            b: Math.round(colors[i].b + t * (colors[i + 1].b - colors[i].b))
          };
        }
      }
      return colors[colors.length - 1];
    }

    const startColor = colorAt(start);
    const endColor = colorAt(end);

    // For vertical: blue on top (0%), orange on bottom (100%)
    // For horizontal: orange on left (0%), blue on right (100%)
    const angle = direction === 'vertical' ? '180deg' : '90deg';

    // Check if we span the middle (teal) color
    const midPos = 0.5;
    if (start < midPos && end > midPos) {
      const midColor = colorAt(midPos);
      const midPct = ((midPos - start) / (end - start)) * 100;

      // Both directions: start to end (orange at start, blue at end)
      // Vertical: top = start of show portion, bottom = end
      // Horizontal: left = start of show portion, right = end
      return `linear-gradient(${angle}, rgb(${startColor.r},${startColor.g},${startColor.b}) 0%, rgb(${midColor.r},${midColor.g},${midColor.b}) ${midPct}%, rgb(${endColor.r},${endColor.g},${endColor.b}) 100%)`;
    }

    // Simple two-color gradient
    return `linear-gradient(${angle}, rgb(${startColor.r},${startColor.g},${startColor.b}) 0%, rgb(${endColor.r},${endColor.g},${endColor.b}) 100%)`;
  }

  function getShowsForDay(day) {
    const dayTime = day.getTime();
    return showsData.filter((show) => {
      return dayTime >= show.startDate.getTime() && dayTime <= show.endDate.getTime();
    });
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

    // Show deadlines always show as stage 3 (blue)
    if (item.type === "showdeadline") {
      stage = 3;
    }

    const letter = item.type === "artstart" ? "A" : item.type === "copydesk" ? "C" : "S";

    return `
      <button class="ascend-calendar-item ascend-calendar-item--${item.type}" data-calendar-item="${escapeAttr(item.jobKey)}">
        <div class="ascend-calendar-item-provenance">
          <div class="ascend-calendar-item-progress" data-stage="${stage}">
            <div class="ascend-calendar-item-dot" data-step="1"></div>
            <div class="ascend-calendar-item-dot" data-step="2"></div>
            <div class="ascend-calendar-item-dot" data-step="3"></div>
          </div>
          <span class="ascend-calendar-item-letter">${letter}</span>
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

    // Find shows and deadline ranges that overlap this month
    const monthStart = firstDay;
    const monthEnd = lastDay;
    const monthShows = showsData.filter((show) => {
      return show.startDate <= monthEnd && show.endDate >= monthStart;
    });
    const monthDeadlineRanges = deadlineRangesData.filter((range) => {
      return range.startDate <= monthEnd && range.endDate >= monthStart;
    });

    const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const totalCells = Math.ceil((startOffset + lastDay.getDate()) / 7) * 7;
    const numRows = totalCells / 7;

    let html = '<div class="ascend-calendar-month">';

    // Header row
    weekdays.forEach((wd) => {
      html += `<div class="ascend-calendar-month-header">${wd}</div>`;
    });

    // Day cells
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

    // Stripes layer (rendered per row for proper positioning)
    html += '<div class="ascend-calendar-month-shows">';
    for (const show of monthShows) {
      html += renderMonthShowStripes(show, year, month, startOffset, lastDay.getDate(), numRows);
    }
    for (const range of monthDeadlineRanges) {
      html += renderMonthDeadlineRangeStripes(range, year, month, startOffset, lastDay.getDate(), numRows);
    }
    html += '</div>';

    html += "</div>";
    return html;
  }

  function renderMonthShowStripes(show, year, month, startOffset, daysInMonth, numRows) {
    const totalShowDays = Math.floor((show.endDate - show.startDate) / (1000 * 60 * 60 * 24)) + 1;
    let html = "";

    // Process each week row
    for (let row = 0; row < numRows; row++) {
      const rowStartCell = row * 7;
      const rowEndCell = rowStartCell + 6;

      // Convert cell indices to actual dates
      const rowStartDayNum = rowStartCell - startOffset + 1;
      const rowEndDayNum = rowEndCell - startOffset + 1;

      const rowStartDate = new Date(year, month, Math.max(1, rowStartDayNum));
      const rowEndDate = new Date(year, month, Math.min(daysInMonth, rowEndDayNum));

      // Check if show overlaps this row
      if (show.endDate < rowStartDate || show.startDate > rowEndDate) continue;

      // Calculate where the show starts/ends in this row
      const showStartInRow = show.startDate > rowStartDate ? show.startDate : rowStartDate;
      const showEndInRow = show.endDate < rowEndDate ? show.endDate : rowEndDate;

      const startCol = showStartInRow.getDate() - rowStartDayNum + (rowStartDayNum < 1 ? startOffset : 0);
      const endCol = showEndInRow.getDate() - rowStartDayNum + (rowStartDayNum < 1 ? startOffset : 0);
      const spanCols = endCol - startCol + 1;

      // Calculate gradient continuity
      const daysBeforeThisRow = Math.max(0, Math.floor((showStartInRow - show.startDate) / (1000 * 60 * 60 * 24)));
      const daysInThisRow = Math.floor((showEndInRow - showStartInRow) / (1000 * 60 * 60 * 24)) + 1;

      // Calculate the portion of the gradient to show
      const gradientStart = daysBeforeThisRow / totalShowDays;
      const gradientEnd = (daysBeforeThisRow + daysInThisRow) / totalShowDays;
      const gradient = generateGradientSlice(gradientStart, gradientEnd, 'horizontal');

      const title = `${show.name}${show.location ? " · " + show.location : ""}`;

      // Calculate position using percentages for the overlay grid
      const leftPct = (startCol / 7) * 100;
      const widthPct = (spanCols / 7) * 100;
      const topPct = (row / numRows) * 100;
      const heightPct = (1 / numRows) * 100;

      html += `
        <div class="ascend-calendar-show-stripe ascend-calendar-show-stripe--horizontal"
             data-show-id="${escapeAttr(show.showId)}"
             style="left: ${leftPct}%; width: ${widthPct}%; top: calc(${topPct}% + 2px); background: ${gradient};"
             title="${escapeAttr(title)}">
        </div>
      `;
    }

    return html;
  }

  function renderMonthDeadlineRangeStripes(range, year, month, startOffset, daysInMonth, numRows) {
    let html = "";

    // Process each week row
    for (let row = 0; row < numRows; row++) {
      const rowStartCell = row * 7;
      const rowEndCell = rowStartCell + 6;

      // Convert cell indices to actual dates
      const rowStartDayNum = rowStartCell - startOffset + 1;
      const rowEndDayNum = rowEndCell - startOffset + 1;

      const rowStartDate = new Date(year, month, Math.max(1, rowStartDayNum));
      const rowEndDate = new Date(year, month, Math.min(daysInMonth, rowEndDayNum));

      // Check if range overlaps this row
      if (range.endDate < rowStartDate || range.startDate > rowEndDate) continue;

      // Calculate where the range starts/ends in this row
      const rangeStartInRow = range.startDate > rowStartDate ? range.startDate : rowStartDate;
      const rangeEndInRow = range.endDate < rowEndDate ? range.endDate : rowEndDate;

      const startCol = rangeStartInRow.getDate() - rowStartDayNum + (rowStartDayNum < 1 ? startOffset : 0);
      const endCol = rangeEndInRow.getDate() - rowStartDayNum + (rowStartDayNum < 1 ? startOffset : 0);
      const spanCols = endCol - startCol + 1;

      const title = `${range.title} · ${range.showName}`;

      // Calculate position using percentages for the overlay grid
      const leftPct = (startCol / 7) * 100;
      const widthPct = (spanCols / 7) * 100;
      const topPct = (row / numRows) * 100;

      html += `
        <div class="ascend-calendar-show-stripe ascend-calendar-show-stripe--horizontal ascend-calendar-show-stripe--deadline"
             data-deadline-range="${escapeAttr(range.showId + '-' + range.title)}"
             style="left: ${leftPct}%; width: ${widthPct}%; top: calc(${topPct}% + 2px);"
             title="${escapeAttr(title)}">
        </div>
      `;
    }

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
    if (!item) {
      console.log("[Calendar] Item not found:", jobKey);
      return;
    }

    // Show deadlines open the show modal with deadline highlighted
    if (item.type === "showdeadline") {
      const show = showsData.find((s) => s.showId === item.showId);
      if (show) {
        openShowModal(show, item.title, item.date, item.date);
      }
      return;
    }

    // ArtStart/Copydesk items open their respective URLs
    if (item.openUrl) {
      window.open(item.openUrl, "_blank", "noopener");
    }
    console.log("[Calendar] Item clicked:", jobKey);
  }

  // ---- Show Modal ----

  function handleShowClick(showId) {
    const show = showsData.find((s) => s.showId === showId);
    if (!show) {
      console.warn("[Calendar] Show not found:", showId);
      return;
    }
    openShowModal(show);
  }

  function handleDeadlineRangeClick(rangeKey) {
    // rangeKey is "showId-title"
    const range = deadlineRangesData.find((r) => (r.showId + '-' + r.title) === rangeKey);
    if (!range) {
      console.warn("[Calendar] Deadline range not found:", rangeKey);
      return;
    }
    const show = showsData.find((s) => s.showId === range.showId);
    if (show) {
      // Open show modal with this deadline range highlighted
      openShowModal(show, range.title, range.startDate, range.endDate);
    }
  }

  function openShowModal(show, highlightDeadline, highlightDateStart, highlightDateEnd) {
    const modalEl = document.getElementById("ascend-show-modal");
    const titleEl = document.getElementById("ascend-show-modal-title");
    const bodyEl = document.getElementById("ascend-show-modal-body");
    const backdropEl = document.getElementById("ascend-show-modal-backdrop");
    const closeEl = document.getElementById("ascend-show-modal-close");

    if (!modalEl || !titleEl || !bodyEl) return;

    // Set title
    titleEl.textContent = show.name;

    // Build body content
    const raw = show.rawShow || {};
    const startStr = formatDate(show.startDate);
    const endStr = formatDate(show.endDate);

    let bodyHtml = "";

    // If opened from a deadline click, show that deadline prominently
    if (highlightDeadline) {
      const dateDisplay = highlightDateEnd && highlightDateEnd.getTime() !== highlightDateStart.getTime()
        ? `${formatDate(highlightDateStart)} – ${formatDate(highlightDateEnd)}`
        : formatDate(highlightDateStart);

      bodyHtml += `
        <div class="ascend-show-modal-highlight">
          <div class="ascend-show-modal-highlight-label">Deadline</div>
          <div class="ascend-show-modal-highlight-value">${escapeHtml(highlightDeadline)}</div>
          <div class="ascend-show-modal-highlight-date">${escapeHtml(dateDisplay)}</div>
        </div>
      `;
    }

    bodyHtml += `
      <div class="ascend-show-modal-dates">
        <div class="ascend-show-modal-date-gradient"></div>
        <div class="ascend-show-modal-date-range">
          <div class="ascend-show-modal-date-start">${escapeHtml(startStr)}</div>
          <div class="ascend-show-modal-date-sep">to</div>
          <div class="ascend-show-modal-date-end">${escapeHtml(endStr)}</div>
        </div>
      </div>
    `;

    // Location
    if (show.location) {
      bodyHtml += renderModalField("Location", show.location);
    }

    // Theme
    if (show.theme) {
      bodyHtml += renderModalField("Theme", show.theme);
    }

    // Line of Business
    if (show.lob) {
      bodyHtml += renderModalField("Line of Business", show.lob);
    }

    // Branding Notes
    if (raw.BrandingNotes) {
      bodyHtml += renderModalField("Branding Notes", raw.BrandingNotes);
    }

    // Media Kit URL
    if (raw.MediaKitUrl) {
      bodyHtml += renderModalField("Media Kit", `<a href="${escapeAttr(raw.MediaKitUrl)}" target="_blank" rel="noopener">View Media Kit</a>`, true);
    }

    // Notes
    if (raw.Notes) {
      bodyHtml += renderModalField("Notes", raw.Notes);
    }

    bodyEl.innerHTML = bodyHtml;

    // Show modal
    modalEl.setAttribute("aria-hidden", "false");

    // Bind close handlers
    const closeModal = () => {
      modalEl.setAttribute("aria-hidden", "true");
      backdropEl.removeEventListener("click", closeModal);
      closeEl.removeEventListener("click", closeModal);
      document.removeEventListener("keydown", handleEsc);
    };

    const handleEsc = (evt) => {
      if (evt.key === "Escape") closeModal();
    };

    backdropEl.addEventListener("click", closeModal);
    closeEl.addEventListener("click", closeModal);
    document.addEventListener("keydown", handleEsc);

    console.log("[Calendar] Show modal opened:", show.showId);
  }

  function renderModalField(label, value, isHtml = false) {
    return `
      <div class="ascend-show-modal-field">
        <div class="ascend-show-modal-label">${escapeHtml(label)}</div>
        <div class="ascend-show-modal-value">${isHtml ? value : escapeHtml(value)}</div>
      </div>
    `;
  }

  function formatDate(date) {
    if (!date) return "";
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric"
    });
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

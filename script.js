"use strict";

(() => {
    const $ = (id) => document.getElementById(id);
    const keys = { history: "qtech_history", holidays: "qtech_holidays", theme: "qtech_theme" };
    const load = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
    const state = { history: load(keys.history, []), holidays: load(keys.holidays, []), calendarDate: new Date(), currentResult: null };
    const GOOGLE_CLIENT_ID = window.QTECH_GOOGLE_CLIENT_ID || "";
    const legalRules = [
        { id: "general", name: "General Calendar Deadline", jurisdiction: "Algeria", method: "Calendar days", description: "Counts each calendar day in the legal period, including weekends unless an adjustment is selected.", guidance: "Use for periods expressed in ordinary calendar days." },
        { id: "working", name: "Working-Day Deadline", jurisdiction: "Algeria", method: "Working days", description: "Counts only working days and excludes Friday, Saturday, and configured holidays.", guidance: "Select Working Days in the calculation method for this rule." },
        { id: "adjustment", name: "Non-Working-Day Adjustment", jurisdiction: "Algeria", method: "Next working day", description: "Moves a calculated deadline that falls on Friday, Saturday, or a configured holiday to the next working day.", guidance: "Enable the adjustment option when the governing rule requires it." },
        { id: "inclusive", name: "Inclusive Starting Date", jurisdiction: "Algeria", method: "Start date included", description: "Treats the starting date as the first counted day when it is an eligible counting day.", guidance: "Enable Include starting date only when the applicable rule calls for it." }
    ];

    const save = (key, value) => localStorage.setItem(key, JSON.stringify(value));
    function parseDate(value) {
        if (!value) return null;
        const parts = value.split("-").map(Number);
        const date = new Date(parts[0], parts[1] - 1, parts[2]);
        return parts.length === 3 && date.getFullYear() === parts[0] && date.getMonth() === parts[1] - 1 && date.getDate() === parts[2] ? date : null;
    }
    const iso = (date) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
    const format = (date, long = false) => date.toLocaleDateString(long ? "en-US" : "en-GB", long ? { weekday: "long", day: "numeric", month: "long", year: "numeric" } : { day: "2-digit", month: "2-digit", year: "numeric" });
    const periodLabel = (amount, unit) => `${amount} ${amount === 1 ? unit.replace(/s$/, "") : unit}`;
    const addDays = (date, amount) => { const result = new Date(date); result.setDate(result.getDate() + amount); return result; };
    const addMonths = (date, amount) => { const result = new Date(date); const day = result.getDate(); result.setDate(1); result.setMonth(result.getMonth() + amount); result.setDate(Math.min(day, new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate())); return result; };
    const isWeekend = (date) => date.getDay() === 5 || date.getDay() === 6;
    const isHoliday = (date) => state.holidays.some((item) => item.date === iso(date));
    const isWorkingDay = (date) => !isWeekend(date) && !isHoliday(date);
    function addWorkingDays(date, amount) { let result = new Date(date); let remaining = Math.max(0, Math.trunc(amount)); while (remaining > 0) { result = addDays(result, 1); if (isWorkingDay(result)) remaining--; } return result; }
    function notify(message, type = "info") { let box = $("qtechNotifications"); if (!box) { box = document.createElement("div"); box.id = "qtechNotifications"; box.setAttribute("aria-live", "polite"); document.body.appendChild(box); } const item = document.createElement("div"); item.className = `qtech-notification qtech-${type}`; item.textContent = message; box.appendChild(item); setTimeout(() => item.remove(), 4000); }
    function updateThemeIcon() { const dark = document.body.classList.contains("dark"); const icon = $("themeIcon"); const button = $("themeToggle"); if (icon) { icon.textContent = dark ? "☾" : "☼"; icon.classList.toggle("is-dark", dark); } if (button) { button.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode"); button.title = dark ? "Switch to light mode" : "Switch to dark mode"; button.setAttribute("aria-pressed", String(dark)); } }
    function focusFirstInput() { const firstInput = $("startDate"); if (firstInput && !firstInput.value) firstInput.focus({ preventScroll: true }); }
    function googleCredential(response) {
        try {
            const payload = JSON.parse(atob(response.credential.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
            localStorage.setItem("qtech_google_profile", JSON.stringify({ name: payload.name, email: payload.email, picture: payload.picture }));
            const userName = document.querySelector(".user-info strong");
            const userEmail = $("userEmail");
            const avatar = document.querySelector(".user-avatar");
            if (userName) userName.textContent = payload.name || payload.email || "Google user";
            if (userEmail) userEmail.textContent = payload.email || "Google account";
            if (avatar) avatar.textContent = (payload.name || "G").charAt(0).toUpperCase();
            notify("Signed in with Google.", "success");
        } catch { notify("Google sign-in response could not be read.", "error"); }
    }
    function initGoogleSignIn() {
        if (!window.google?.accounts?.id || !GOOGLE_CLIENT_ID) return;
        google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: googleCredential, auto_select: false });
    }
    function restoreGoogleProfile() { const profile = load("qtech_google_profile", null); if (!profile) return; const userName = document.querySelector(".user-info strong"); const userEmail = $("userEmail"); const avatar = document.querySelector(".user-avatar"); if (userName) userName.textContent = profile.name || profile.email || "Google user"; if (userEmail) userEmail.textContent = profile.email || "Google account"; if (avatar) avatar.textContent = (profile.name || "G").charAt(0).toUpperCase(); }

    function validateForm() {
        const startInput = $("startDate");
        const durationInput = $("duration");
        const start = parseDate(startInput.value);
        const duration = Number(durationInput.value);
        startInput.setCustomValidity(start ? "" : "Enter a valid starting date.");
        durationInput.setCustomValidity(Number.isInteger(duration) && duration >= 1 ? "" : "Enter a whole number greater than zero.");
        if (!startInput.checkValidity() || !durationInput.checkValidity()) {
            $("deadlineForm").reportValidity();
            notify("Please correct the highlighted fields.", "error");
            return null;
        }
        return { start, duration };
    }

    function buildSmartAnswer(result, originalDeadline, adjusted, includeStart) {
        const method = result.method === "working" ? "working days, excluding Friday, Saturday, and configured holidays" : "calendar days";
        const counting = includeStart ? "The starting date was included." : "The starting date was not included.";
        let adjustment = "The calculated date did not need a non-working-day adjustment.";
        if (adjusted) adjustment = `${format(originalDeadline, true)} fell on a non-working day, so the deadline moved to the next working day.`;
        return `Your legal deadline is ${format(parseDate(result.deadline), true)}. It was counted from ${format(parseDate(result.startDate))} for ${periodLabel(result.duration, result.unit)} using ${method}. ${result.ruleName || "The selected legal rule"} was applied. ${counting} ${adjustment}`;
    }

    function calculate(event) {
        event.preventDefault();
        const values = validateForm();
        if (!values) return;
        const { start, duration } = values;
        const unit = $("unit").value;
        const rule = legalRules.find((item) => item.id === $("legalRule").value) || legalRules[0];
        const method = document.querySelector('input[name="countingMethod"]:checked')?.value || "calendar";
        const includeStart = $("includeStart")?.checked ?? false;
        let deadline = new Date(start);
        if (unit === "months") deadline = addMonths(deadline, duration);
        else if (unit === "years") deadline = addMonths(deadline, duration * 12);
        else { const days = unit === "weeks" ? duration * 7 : duration; const firstDayCounts = includeStart && (method === "calendar" || isWorkingDay(deadline)); if (firstDayCounts) deadline = method === "working" ? addWorkingDays(deadline, days - 1) : addDays(deadline, days - 1); else deadline = method === "working" ? addWorkingDays(deadline, days) : addDays(deadline, days); }
        const originalDeadline = new Date(deadline);
        let adjusted = false;
        if ($("moveFromHoliday")?.checked) while (!isWorkingDay(deadline)) { deadline = addDays(deadline, 1); adjusted = true; }
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const remaining = Math.round((deadline - today) / 86400000);
        const result = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, startDate: iso(start), deadline: iso(deadline), originalDeadline: iso(originalDeadline), duration, unit, method, ruleId: rule.id, ruleName: rule.name, includeStart, adjusted, remaining };
        const smartAnswer = buildSmartAnswer(result, originalDeadline, adjusted, includeStart);
        $("deadlineDate").textContent = format(deadline, true); $("deadlineDate").dateTime = iso(deadline); $("resultStart").textContent = format(start); $("resultPeriod").textContent = periodLabel(duration, unit); $("resultMethod").textContent = method === "working" ? "Working Days" : "Calendar Days"; $("resultRemaining").textContent = remaining < 0 ? `${Math.abs(remaining)} day(s) overdue` : remaining === 0 ? "Due today" : `${remaining} day(s) remaining`; $("deadlineStatus").textContent = remaining < 0 ? "Expired" : remaining <= 7 ? "Urgent" : "Calculated"; $("calculationBasis").textContent = `Calculated from ${format(start)} using ${method === "working" ? "working days" : "calendar days"}.`;
        $("smartAnswer").querySelector("p").textContent = smartAnswer;
        state.currentResult = result; state.history.unshift(result); state.history = state.history.slice(0, 500); save(keys.history, state.history); updateDashboard(); renderHistory();
        if (typeof navigator.vibrate === "function") navigator.vibrate([80, 40, 80]);
        notify("Deadline calculated successfully.", "success");
    }
    function updateDashboard() { $("totalCalculations").textContent = state.history.length; $("activeDeadlines").textContent = state.history.filter((item) => item.remaining >= 0).length; $("expiringSoon").textContent = state.history.filter((item) => item.remaining >= 0 && item.remaining <= 7).length; $("savedRules").textContent = legalRules.length; }
    function updateGreeting() { const greeting = $("dashboardGreeting"); if (!greeting) return; const hour = new Date().getHours(); const salutation = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"; greeting.textContent = `${salutation}, Legal Dashboard`; }
    function renderRuleOptions() { const select = $("legalRule"); if (!select) return; select.innerHTML = legalRules.map((rule) => `<option value="${rule.id}">${rule.name}</option>`).join(""); }
    function applyRulePreset() { const ruleId = $("legalRule")?.value; if (ruleId === "working") { $("workingMethod")?.click(); $("moveFromHoliday").checked = false; $("includeStart").checked = false; } if (ruleId === "general") { $("calendarMethod")?.click(); $("moveFromHoliday").checked = false; $("includeStart").checked = false; } if (ruleId === "adjustment") $("moveFromHoliday").checked = true; if (ruleId === "inclusive") $("includeStart").checked = true; }
    function renderRules() { const list = $("rulesList"); if (!list) return; list.innerHTML = legalRules.map((rule) => `<article class="panel rule-card"><div class="rule-card-header"><span class="eyebrow">${rule.jurisdiction}</span><span class="status-badge">Active</span></div><h2>${rule.name}</h2><p>${rule.description}</p><div class="rule-meta"><span>Counting method</span><strong>${rule.method}</strong><small>${rule.guidance}</small></div></article>`).join(""); }
    function renderHistory() { const body = $("historyTableBody"); if (!body) return; if (!state.history.length) { body.innerHTML = '<tr><td colspan="6" class="empty-state">No calculation history.</td></tr>'; return; } body.innerHTML = state.history.map((item) => `<tr><td>${format(parseDate(item.startDate))}</td><td>${periodLabel(item.duration, item.unit)}</td><td>${item.method === "working" ? "Working Days" : "Calendar Days"}</td><td>${format(parseDate(item.deadline))}</td><td>Calculated</td><td><button type="button" data-view-id="${item.id}">View</button></td></tr>`).join(""); body.querySelectorAll("[data-view-id]").forEach((button) => button.addEventListener("click", () => { const item = state.history.find((entry) => entry.id === button.dataset.viewId); if (item) { location.hash = "calculator"; displayResult(item); } })); }
    function displayResult(item) { $("deadlineDate").textContent = format(parseDate(item.deadline), true); $("resultStart").textContent = format(parseDate(item.startDate)); $("resultPeriod").textContent = periodLabel(item.duration, item.unit); $("resultMethod").textContent = item.method === "working" ? "Working Days" : "Calendar Days"; $("deadlineStatus").textContent = "Saved"; if ($("smartAnswer")) $("smartAnswer").querySelector("p").textContent = buildSmartAnswer(item, parseDate(item.originalDeadline || item.deadline), Boolean(item.adjusted), Boolean(item.includeStart)); }
    function renderCalendar() { const toolbar = $("calendarToolbar"); const grid = $("calendarGrid"); if (!toolbar || !grid) return; const date = state.calendarDate; toolbar.innerHTML = `<button type="button" id="previousMonth">Previous</button><strong>${date.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</strong><button type="button" id="nextMonth">Next</button>`; grid.innerHTML = ""; const offset = (new Date(date.getFullYear(), date.getMonth(), 1).getDay() + 6) % 7; for (let index = 0; index < offset; index++) grid.insertAdjacentHTML("beforeend", '<div class="calendar-day empty"></div>'); for (let day = 1; day <= new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate(); day++) { const current = new Date(date.getFullYear(), date.getMonth(), day); const cell = document.createElement("div"); cell.className = `calendar-day ${isWeekend(current) ? "non-working" : ""} ${isHoliday(current) ? "holiday" : ""}`; cell.textContent = day; grid.appendChild(cell); } $("previousMonth").addEventListener("click", () => { state.calendarDate = addMonths(state.calendarDate, -1); renderCalendar(); }); $("nextMonth").addEventListener("click", () => { state.calendarDate = addMonths(state.calendarDate, 1); renderCalendar(); }); }
    function closeSidebar() { const app = $("app"); const menu = $("menuToggle"); if (!app) return; app.classList.remove("sidebar-open"); document.body.classList.remove("sidebar-lock"); menu?.setAttribute("aria-expanded", "false"); menu?.setAttribute("aria-label", "Open navigation"); }
    function toggleSidebar() { const app = $("app"); const menu = $("menuToggle"); if (!app) return; const open = app.classList.toggle("sidebar-open"); document.body.classList.toggle("sidebar-lock", open); menu?.setAttribute("aria-expanded", String(open)); menu?.setAttribute("aria-label", open ? "Close navigation" : "Open navigation"); }
    function navigate() { const page = location.hash.slice(1) || "dashboard"; document.querySelectorAll("[data-page-section]").forEach((section) => { section.hidden = section.id !== page; }); document.querySelectorAll("[data-page]").forEach((item) => item.classList.toggle("active", item.dataset.page === page)); if (page === "calendar") renderCalendar(); }

    $("deadlineForm")?.addEventListener("submit", calculate);
    $("resetButton")?.addEventListener("click", () => setTimeout(() => { $("deadlineStatus").textContent = "Ready"; }, 0));
    $("saveCalculation")?.addEventListener("click", () => state.currentResult ? notify("Calculation is already saved.", "success") : notify("Calculate a deadline first.", "error"));
    function resultText() { const result = state.currentResult; if (!result) return "Calculate a deadline first."; return ["QTech Legal Deadline", `Starting date: ${result.startDate}`, `Deadline: ${result.deadline}`, `Period: ${periodLabel(result.duration, result.unit)}`, `Rule: ${result.ruleName || "Selected legal rule"}`, `Method: ${result.method === "working" ? "Working days" : "Calendar days"}`].join("\n"); }
    async function copyResult() {
        if (!state.currentResult) { notify("Calculate a deadline first.", "error"); return; }
        try { await navigator.clipboard.writeText(resultText()); notify("Result copied to clipboard.", "success"); } catch { notify("Clipboard access was denied. Select and copy the result manually.", "error"); }
    }
    function exportResult() {
        if (!state.currentResult) { notify("Calculate a deadline first.", "error"); return; }
        const blob = new Blob([resultText()], { type: "text/plain;charset=utf-8" }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `qtech-deadline-${state.currentResult.deadline}.txt`; link.click(); URL.revokeObjectURL(link.href); notify("Result exported.", "success");
    }
    function createCalendarFile() {
        if (!state.currentResult) { notify("Calculate a deadline first.", "error"); return; }
        const result = state.currentResult;
        const date = result.deadline.replace(/-/g, "");
        const content = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//QTech Legal//Deadline Calculator//EN", "BEGIN:VEVENT", `UID:${result.id}@qtech-legal`, `DTSTAMP:${date}T090000Z`, `DTSTART;VALUE=DATE:${date}`, "SUMMARY:QTech Legal Deadline", `DESCRIPTION:Deadline from ${result.startDate}; period ${result.duration} ${result.unit}.`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
        const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([content], { type: "text/calendar;charset=utf-8" })); link.download = `qtech-deadline-${result.deadline}.ics`; link.click(); URL.revokeObjectURL(link.href); notify("Calendar file downloaded.", "success");
    }
    function drawReportCard() {
        if (!state.currentResult) { notify("Calculate a deadline first.", "error"); return; }
        const result = state.currentResult; const canvas = document.createElement("canvas"); canvas.width = 1200; canvas.height = 700; const context = canvas.getContext("2d");
        context.fillStyle = "#102a43"; context.fillRect(0, 0, canvas.width, canvas.height); context.fillStyle = "#ffffff"; context.font = "bold 42px Georgia"; context.fillText("QTech Legal", 70, 100); context.font = "28px Trebuchet MS"; context.fillStyle = "#8de3d7"; context.fillText("OFFICIAL DEADLINE REPORT", 70, 155); context.fillStyle = "#ffffff"; context.font = "bold 54px Georgia"; context.fillText(format(parseDate(result.deadline), true), 70, 290); context.font = "26px Trebuchet MS"; context.fillStyle = "#d9e2ec"; context.fillText(`Starting date: ${result.startDate}`, 70, 380); context.fillText(`Period: ${result.duration} ${result.unit}`, 70, 430); context.fillText(`Method: ${result.method === "working" ? "Working days" : "Calendar days"}`, 70, 480); context.fillText("Generated by QTech Legal", 70, 610);
        const link = document.createElement("a"); link.href = canvas.toDataURL("image/png"); link.download = `qtech-deadline-${result.deadline}.png`; link.click(); notify("Report image downloaded.", "success");
    }
    $("copyResult")?.addEventListener("click", copyResult);
    $("exportResult")?.addEventListener("click", exportResult);
    $("calendarResult")?.addEventListener("click", createCalendarFile);
    $("imageResult")?.addEventListener("click", drawReportCard);
    $("printResult")?.addEventListener("click", () => window.print());
    $("deadlineImage")?.addEventListener("change", (event) => { const file = event.target.files?.[0]; if (file) { $("imageStatus").textContent = `${file.name} selected`; notify("Image captured and ready for your case file.", "success"); } });
    $("clearHistory")?.addEventListener("click", () => { state.history = []; save(keys.history, state.history); updateDashboard(); renderHistory(); });
    $("holidayForm")?.addEventListener("submit", (event) => { event.preventDefault(); const date = $("holidayDate").value; if (date && !state.holidays.some((item) => item.date === date)) { state.holidays.push({ date, name: $("holidayName").value || "Holiday" }); save(keys.holidays, state.holidays); updateDashboard(); notify("Holiday added.", "success"); } event.target.reset(); });
    $("legalRule")?.addEventListener("change", applyRulePreset);
    $("themeToggle")?.addEventListener("click", () => { document.body.classList.toggle("dark"); save(keys.theme, document.body.classList.contains("dark") ? "dark" : "light"); updateThemeIcon(); });
    $("userButton")?.addEventListener("click", () => { if (window.google?.accounts?.id && GOOGLE_CLIENT_ID) google.accounts.id.prompt(); else notify("Google sign-in is not configured yet.", "info"); });
    $("menuToggle")?.addEventListener("click", toggleSidebar);
    document.querySelectorAll("[data-page]").forEach((item) => item.addEventListener("click", () => { location.hash = item.dataset.page; closeSidebar(); }));
    document.addEventListener("click", (event) => { const app = $("app"); const sidebar = $("sidebar"); const menu = $("menuToggle"); if (app?.classList.contains("sidebar-open") && sidebar && !sidebar.contains(event.target) && !menu?.contains(event.target)) closeSidebar(); });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeSidebar(); });
    window.addEventListener("resize", () => { if (window.innerWidth > 640) closeSidebar(); });
    window.addEventListener("hashchange", navigate);
    window.addEventListener("load", initGoogleSignIn, { once: true });
    $("deadlineForm")?.addEventListener("focusin", (event) => { if (event.target.matches("input, select")) event.target.scrollIntoView({ behavior: "smooth", block: "center" }); });
    $("deadlineForm")?.addEventListener("keydown", (event) => { if (event.key === "Enter" && event.target.matches("input")) { event.preventDefault(); $("deadlineForm").requestSubmit(); } });
    const theme = load(keys.theme, "light"); if (theme === "dark") document.body.classList.add("dark"); updateThemeIcon();
    renderRuleOptions(); updateDashboard(); renderHistory(); renderRules(); updateGreeting(); navigate(); focusFirstInput(); restoreGoogleProfile(); initGoogleSignIn();
})();

// ---------- imports ----------
// Pure helpers extracted to lib/ so they can be unit-tested in Node.
// Anything that doesn't touch DOM/state should live there.
import { escapeHTML, escapeAttr, escapeRegExp, safeUrl, resolveUrl } from "./lib/sanitize.js";
import {
  getStructuredPosition,
  classifyAd,
  fieldTags,
  primaryField,
  condenseRanks,
  abbreviateRank,
  relevanceTag,
  listingStatus,
  FIELD_ORDER,
  HSS_SUBJECT_FILTER_LABELS,
  QUALITY_LABELS,
} from "./lib/classify.js";
import {
  sanitizeExcerpt,
  SUBSTANTIVE_MARKERS,
  INSTITUTIONAL_BOILERPLATE,
} from "./lib/excerpt.js";
import {
  STATUTORY_TARGETS, CAT_FULL_NAMES, CORPUS_STATS,
  computeIneq, vacRateChart, realisationChart,
  chart0_volume, chart5_disclosure_v2, chartx_boilerplate, charty_topics,
  chartCard,
  chart1_vacancyTimeline, chart2_mandateVsReality, chart3_kharge,
  chart4_aiims, chart5_disclosure, chart6_whoIsAsking, chart7_rdGap,
  chart8_counterfactual,
  realisationSlopeChart, realisationDonut, rdGapPanel, talentPipeline,
  castePyramid, counterfactualTicker, khargeRankMatrix,
  vacancyTimelineChart, missionModeRealisationChart, disclosureMatrix,
  aiimsNetworkPanel, mpsAskingPanel,
  RTI_TEMPLATES, POSTDOC_ABROAD, RESOURCES_BLOCKS,
  renderVacancies,
} from "./lib/charts.js";

// DEBUG: confirm app.js evaluates and post-import code runs.
window.__appLoaded = true;

// ---------- state ----------
// Mutable shared state lives in lib/state.js as a single `state` object.
// This module reads/writes via state.ADS / state.COVERAGE / state.INSTITUTIONS;
// other modules (lib/card-helpers.js, etc.) import the same `state` and see
// the same object. Reassignment goes through state.X = newValue; mutation
// goes through state.X[key] = ... as before.
import { state, persistSaved } from "./lib/state.js";
import {
  HIRING_TRAPS, extractTraps,
  renderAd, wireAdActions, renderInstitutionAggregate,
} from "./lib/render-card.js";

// When an institution group exceeds this threshold within the current
// filtered view, render a single aggregated card instead of N individual
// cards. JNU's 122-post advertisement is the motivating case.
const INSTITUTION_AGGREGATE_THRESHOLD = 10;
import {
  getChecked, currentFilterState, filterHaystack,
  applyFilters, isReservedPost, applySort,
  adPassesFilter, updateReactiveCounts, lifecycleStatus,
} from "./lib/filters.js";
import {
  initMap, updateMapMarkers, typeLabel,
} from "./lib/map.js";
import {
  renderResources, renderSaved, renderCoverage,
} from "./lib/render-tabs.js";
import { validateCurrentShape } from "./lib/current-validator.js";
import {
  TYPE_COLORS,
  detectAdCampus, cityAlreadyInInstitutionName,
  parseDate, daysUntil, urgencyTier, formatDate, formatCountdown, daysSince,
  sourceLabel, sourceLinkLabel,
  isAsstProfMatch, isAssocProfMatch, isFullProfMatch, isResearchMatch,
  isVisitingMatch, isFacultyMatch,
  contractLabel,
  DEPARTMENT_UNIT_OVERRIDES,
  normalizeRecruitingUnitName, normalizeDisciplineName,
  inferRecruitingUnitFromText, titleFieldLabel,
  cardDiscipline,
  canonicalAreaLabel, cleanNumberedCueItem, extractNumberedCueItems,
  summarizeEligibilityCue, summarizeEvaluationCue,
  structuredEligibilityCue, structuredEvaluationCue, structuredCues,
  extractCardCues,
  cardRankLine,
} from "./lib/card-helpers.js";
const TYPE_ORDER = ["IIT","IIM","PrivateUniversity","IISc","IISER","CentralUniversity","StateUniversity","NIT","IIIT"];
const LIFECYCLE_LABELS = {
  active: "Live",
  stale: "Not freshly confirmed",
  missing: "Missing from latest sweep",
  closed: "Closed",
};
// TYPE_COLORS imported from lib/card-helpers.js.
// SAVED + persistSaved live on state (lib/state.js) — accessed via state.SAVED.
const SAVED = state.SAVED;
// typeLabel moved to lib/map.js (its main consumer); imported below.

// ---------- classifier (extracted) ----------
// classifyAd, fieldTags, primaryField, FIELD_RULES, FIELD_ORDER,
// HSS_SUBJECT_FILTER_LABELS, QUALITY_LABELS, NON_HSS_FIELD_TAGS, and the
// PROFILE_POS_A / PROFILE_POS_B / PROFILE_NEG / FACULTY_HINT regex banks
// all live in docs/lib/classify.js. Imported above. Tested in tests/.

// ---------- helpers ----------
// escapeHTML, escapeAttr, escapeRegExp imported from lib/sanitize.js (top of file).

// Per-listing campus detection. Multi-campus institutions (Azim Premji
// Bengaluru / Bhopal / Ranchi; AIIMS; BITS Pilani; etc.) carry one
// registry city — usually the main campus. When the ad text actually
// names a different campus, that's the campus the candidate would
// move to. Override the registry default with what the ad says.


// ---------- data load ----------
async function loadData() {
  // We used to cache-bust JSON fetches with `?v=${Date.now()}` to defeat the
  // browser's HTTP cache during dev. That worked but billed every reload as a
  // full re-download (1-5 MB of JSON). Instead we use `cache: "no-cache"` in
  // the Fetch API — the browser sends `If-Modified-Since` / `If-None-Match`
  // and the server returns 304 if nothing changed, so reloads are cheap when
  // data hasn't moved.
  const opts = { cache: "no-cache" };
  try {
    const [current, coverage, registry] = await Promise.all([
      fetch("data/current.json", opts).then(r => r.json()),
      fetch("data/coverage_report.json", opts).then(r => r.json()).catch(() => null),
      fetch("data/institutions_registry.json", opts).then(r => r.json()),
    ]);
    const currentShape = validateCurrentShape(current);
    if (!currentShape.ok) {
      throw new Error(`current.json failed validation: ${currentShape.errors.join("; ")}`);
    }
    if (currentShape.invalid.length) {
      console.warn("Dropped invalid ad records from current.json", currentShape.invalid);
    }
    state.ADS = currentShape.ads.filter(ad => {
      const sp = getStructuredPosition(ad);
      const pt = sp ? sp.post_type : ad.post_type;
      return pt !== "NonFaculty";
    });
    state.COVERAGE = coverage;
    for (const inst of registry) state.INSTITUTIONS[inst.id] = inst;
    // Footer colophon — surface the data freshness as a human-readable
    // date so visitors can judge whether the site is being maintained.
    const updatedEl = document.getElementById("colophon-updated");
    if (updatedEl && current.generated_at) {
      try {
        const d = new Date(current.generated_at);
        const fmt = d.toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" });
        const liveCount = state.ADS.filter(ad => lifecycleStatus(ad) === "active").length;
        updatedEl.textContent = `Last updated ${fmt} · ${liveCount} live listings · ${state.ADS.length} retained records`;
      } catch { updatedEl.textContent = `Last updated ${current.generated_at}`; }
    }
  } catch (e) {
    document.getElementById("feed-items").innerHTML = `<div class="banner"><strong>Data unavailable.</strong> Please try again later.</div>`;
    return;
  }
  populateFilters();
  wireEvents();
  wirePortrait();
  render();
  renderCoverage();
  // Maintainer escape hatch: visiting `…/dashboard/#coverage` opens the
  // (now hidden-from-nav) coverage panel. Keeps the monitoring view
  // accessible to whoever maintains the scraper without showing it to
  // end users.
  if (location.hash === "#coverage") {
    document.querySelectorAll("nav.tabs button[data-tab]").forEach(b => b.classList.remove("active"));
    for (const name of ["listings", "saved", "map", "vacancies", "resources", "about", "coverage"]) {
      const panel = document.getElementById(name + "-tab");
      if (panel) panel.style.display = (name === "coverage") ? "" : "none";
    }
  }
}

// Hide the masthead portrait if the image fails to load (e.g. no logo.jpg
// committed yet). Done via an event listener instead of an inline `onerror=`
// attribute so the page stays CSP-friendly and the failure mode is explicit.
function wirePortrait() {
  const img = document.getElementById("masthead-portrait");
  if (!img) return;
  const fig = img.closest("figure");
  if (img.complete && img.naturalWidth === 0) {
    if (fig) fig.style.display = "none";
    return;
  }
  img.addEventListener("error", () => {
    if (fig) fig.style.display = "none";
  });
}

// ---------- filters ----------
function renderCheckboxes(containerId, options) {
  const c = document.getElementById(containerId);
  c.innerHTML = options.map(o => {
    const disabled = o.disabled ? " disabled" : "";
    const style = o.disabled ? ' style="opacity:0.4"' : "";
    const checked = o.checked ? " checked" : "";
    const cnt = o.count != null ? `<span class="cnt">${o.count}</span>` : "";
    return `<label${style}><input type="checkbox" value="${escapeAttr(o.value)}"${disabled}${checked} /><span class="grow">${escapeHTML(o.label)}</span>${cnt}</label>`;
  }).join("");
  // Browsers (Firefox especially) auto-restore form state on reload, ignoring the
  // `checked` attribute. Force the .checked property after render to match the
  // declared default — otherwise a previous session's selections silently persist.
  c.querySelectorAll("input[type=checkbox]").forEach((el, i) => {
    el.checked = !!options[i].checked;
  });
}

function populateFilters() {
  // Force posgroup checkboxes off on every load. The HTML default is also
  // unchecked, but browsers persist checkbox state across reloads — without
  // this reset, a user who once checked "Faculty" would see it ticked on
  // every subsequent visit. Default-unchecked = no posgroup constraint =
  // all post types visible, which is the right empty-state.
  document.querySelectorAll("#filter-posgroup input").forEach(el => { el.checked = false; });
  const search = document.getElementById("search");
  if (search) search.value = "";
  const typeCounts = {}, stateCounts = {}, fieldCounts = {}, qualityCounts = { hss: 0, "non-hss": 0, other: 0 };
  const typeOptions = new Set(), stateOptions = new Set(), fieldOptions = new Set();
  const lifecycleCounts = { active: 0, stale: 0, missing: 0, closed: 0 };
  let facultyTotal = 0, associateTotal = 0, fullTotal = 0, researchTotal = 0, visitingTotal = 0;
  for (const ad of state.ADS) {
    const life = lifecycleStatus(ad);
    lifecycleCounts[life] = (lifecycleCounts[life] || 0) + 1;
    const inst = state.INSTITUTIONS[ad.institution_id] || {};
    if (inst.type) typeOptions.add(inst.type);
    if (inst.state) stateOptions.add(inst.state);
    for (const field of fieldTags(ad)) fieldOptions.add(field);
    if (life !== "active") continue;
    if (inst.type) typeCounts[inst.type] = (typeCounts[inst.type] || 0) + 1;
    if (inst.state) stateCounts[inst.state] = (stateCounts[inst.state] || 0) + 1;
    for (const field of fieldTags(ad)) fieldCounts[field] = (fieldCounts[field] || 0) + 1;
    qualityCounts[listingStatus(ad)]++;
    if (isAsstProfMatch(ad)) facultyTotal++;
    if (isAssocProfMatch(ad)) associateTotal++;
    if (isFullProfMatch(ad)) fullTotal++;
    if (isResearchMatch(ad)) researchTotal++;
    if (isVisitingMatch(ad)) visitingTotal++;
  }

  const orderedFields = [
    ...FIELD_ORDER.filter(f => fieldOptions.has(f)),
    ...[...fieldOptions].filter(f => !FIELD_ORDER.includes(f)).sort(),
  ];
  // Default to none checked. "No selection = no constraint" is the same
  // semantics every other facet uses, and it keeps the active-filter chip
  // bar from drowning in 20+ chips on first load.
  renderCheckboxes("filter-hss", orderedFields.map(f => ({
    value: f,
    label: f,
    count: fieldCounts[f] || 0,
    checked: false,
  })));

  // Relevance: HSS is profile-relevant (anthro / STS / sociology / public
  // policy / etc.), non-HSS is the engineering / pure-STEM / finance /
  // management bucket the user has explicitly excluded, Other catches the
  // generic-faculty-call ads where no field could be inferred. HSS
  // checked by default — this is a research-tracker for an HSS user.
  renderCheckboxes("filter-quality", [
    { value: "hss", label: QUALITY_LABELS.hss, count: qualityCounts.hss, checked: false },
    { value: "non-hss", label: QUALITY_LABELS["non-hss"], count: qualityCounts["non-hss"], checked: false },
    { value: "other", label: QUALITY_LABELS.other, count: qualityCounts.other, checked: false },
  ]);

  renderCheckboxes("filter-lifecycle", ["active", "stale", "missing", "closed"].map(value => ({
    value,
    label: LIFECYCLE_LABELS[value],
    count: lifecycleCounts[value] || 0,
    checked: false,
  })));

  // Render only types that actually appear in the data. TYPE_ORDER pins
  // display order for known types; any unknown types get appended in the
  // order they first appear so we don't silently drop e.g. "Other" or new
  // categories added to the registry.
  const orderedTypes = [
    ...TYPE_ORDER.filter(t => typeOptions.has(t)),
    ...[...typeOptions].filter(t => !TYPE_ORDER.includes(t)).sort(),
  ];
  renderCheckboxes("filter-type", orderedTypes.map(t => ({
    value: t,
    label: typeLabel(t),
    count: typeCounts[t] || 0,
  })));

  document.getElementById("cnt-faculty").textContent = facultyTotal;
  document.getElementById("cnt-associate").textContent = associateTotal;
  document.getElementById("cnt-full").textContent = fullTotal;
  document.getElementById("cnt-research").textContent = researchTotal;
  document.getElementById("cnt-visiting").textContent = visitingTotal;

  renderCheckboxes("filter-state",
    [...stateOptions].sort().map(s => ({ value: s, label: s, count: stateCounts[s] || 0 }))
  );
}

// ---------- event wiring ----------
function wireEvents() {
  const setSearchValue = (value, { mapListKey = "" } = {}) => {
    const search = document.getElementById("search");
    const heroSearch = document.getElementById("hero-search");
    const heroClear = document.getElementById("hero-search-clear");
    if (search) search.value = value;
    if (heroSearch) heroSearch.value = value;
    if (heroClear) heroClear.hidden = value.length === 0;
    window._mapListKey = mapListKey;
  };

  for (const id of ["filter-hss","filter-quality","filter-lifecycle","filter-type","filter-posgroup","filter-state"]) {
    document.getElementById(id).addEventListener("change", render);
  }
  document.getElementById("search").addEventListener("input", () => {
    window._mapListKey = "";
    render();
  });
  document.getElementById("sort").addEventListener("change", render);

  // ---- Phase-2 hero search ---------------------------------------------
  // The hero input is the user-facing field; the legacy `#search` (now a
  // hidden input) is the value the rest of the JS reads. Mirror writes.
  const heroSearch = document.getElementById("hero-search");
  const heroClear = document.getElementById("hero-search-clear");
  if (heroSearch) {
    heroSearch.addEventListener("input", () => {
      setSearchValue(heroSearch.value);
      render();
    });
    heroClear.addEventListener("click", () => {
      setSearchValue("");
      heroSearch.focus();
      render();
    });
  }

  // ---- Phase-2 quick chips ---------------------------------------------
  // Each chip is a one-click toggle that sets the corresponding sidebar
  // checkboxes. The chip's `on` state mirrors whether *all* of its target
  // boxes are currently checked, so the chip and the sidebar stay in sync
  // even when the user toggles things in the sidebar manually.
  const QUICK_FILTERS = {
    "hss": { groupId: "filter-hss",
             targets: () => Array.from(document.querySelectorAll("#filter-hss input"))
                            .filter(i => i.value !== "Other" && i.value !== "Pure STEM/Engineering") },
    "closing-soon": null,  // handled inline (synthetic — not a checkbox set)
    "faculty": { groupId: "filter-posgroup",
                 targets: () => [document.querySelector('#filter-posgroup input[value="faculty"]')] },
    "postdoc": { groupId: "filter-posgroup",
                 targets: () => [document.querySelector('#filter-posgroup input[value="research"]')] },
  };

  // Synthetic filters — no checkbox group; window-scoped state.
  window._closingSoonOnly = false;
  window._reservedOnly = false;
  window._includeArchive = false;
  window._mapListKey = "";

  const refreshChipStates = () => {
    document.querySelectorAll(".quick-chip").forEach(chip => {
      const key = chip.dataset.quick;
      let on = false;
      if (key === "closing-soon") on = window._closingSoonOnly;
      else if (key === "reserved") on = window._reservedOnly;
      else if (key === "archive") on = window._includeArchive;
      else {
        const cfg = QUICK_FILTERS[key];
        const targets = cfg?.targets()?.filter(Boolean) ?? [];
        on = targets.length > 0 && targets.every(i => i.checked);
      }
      chip.classList.toggle("on", on);
      chip.setAttribute("aria-pressed", on);
    });
  };
  refreshChipStates();

  document.querySelectorAll(".quick-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const key = chip.dataset.quick;
      if (key === "closing-soon") {
        window._closingSoonOnly = !window._closingSoonOnly;
      } else if (key === "reserved") {
        window._reservedOnly = !window._reservedOnly;
      } else if (key === "archive") {
        window._includeArchive = !window._includeArchive;
        if (!window._includeArchive) {
          document.querySelectorAll("#filter-lifecycle input").forEach(el => { el.checked = false; });
        }
      } else {
        const cfg = QUICK_FILTERS[key];
        if (!cfg) return;
        const targets = cfg.targets().filter(Boolean);
        const allOn = targets.every(i => i.checked);
        targets.forEach(i => { i.checked = !allOn; });
      }
      refreshChipStates();
      render();
    });
  });

  // Re-sync chips after every render so manual sidebar toggles keep the
  // chip "on" state honest.
  const _origRender = window.render;
  if (_origRender && !window._chipsHooked) {
    window.render = function() { _origRender.apply(this, arguments); refreshChipStates(); };
    window._chipsHooked = true;
  }

  // ---- Filter-strip popover open/close ---------------------------------
  // Click the trigger to toggle. Click outside to close. ESC closes too.
  // One open at a time so popovers don't overlap.
  // Each open/close also flips `aria-expanded` on the trigger so AT users
  // know the popover state matches what sighted users see.
  const closeAllDropdowns = () => {
    document.querySelectorAll(".filter-dd.open").forEach(d => {
      d.classList.remove("open");
      const trigger = d.querySelector(".filter-trigger");
      if (trigger) trigger.setAttribute("aria-expanded", "false");
    });
  };
  document.querySelectorAll(".filter-dd .filter-trigger").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const dd = btn.closest(".filter-dd");
      const wasOpen = dd.classList.contains("open");
      closeAllDropdowns();
      if (!wasOpen) {
        dd.classList.add("open");
        btn.setAttribute("aria-expanded", "true");
      }
    });
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".filter-dd")) closeAllDropdowns();
    
    const pill = e.target.closest(".reserv-pill");
    if (pill) {
      const match = Array.from(pill.classList).find(c => c.startsWith("r-"));
      if (match) {
        const cat = match.slice(2);
        setSearchValue(cat);
        render();
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAllDropdowns();
  });
  // Per-popover "Clear" buttons (data-clear="filter-<id>") uncheck every
  // input inside the matching filter-group.
  document.querySelectorAll(".popover-foot button[data-clear]").forEach(btn => {
    btn.addEventListener("click", () => {
      const groupId = btn.dataset.clear;
      document.querySelectorAll(`#${groupId} input`).forEach(i => { i.checked = false; });
      render();
    });
  });

  // Banner dismiss — persist to localStorage so it stays dismissed across reloads.
  const banner = document.getElementById("verify-banner");
  if (banner && localStorage.getItem("hei.banner-dismissed") === "1") {
    banner.style.display = "none";
  }
  document.getElementById("dismiss-banner")?.addEventListener("click", () => {
    banner.style.display = "none";
    localStorage.setItem("hei.banner-dismissed", "1");
  });

  // Theme toggle — sun for "switch to light", moon for "switch to dark".
  // The icon shows the destination theme so the click direction is unambiguous.
  const themeBtn = document.getElementById("theme-toggle");
  const setThemeIcon = () => {
    const current = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    themeBtn.textContent = current === "dark" ? "☀" : "☾";
    themeBtn.title = current === "dark" ? "Switch to light mode" : "Switch to dark mode";
  };
  setThemeIcon();
  themeBtn.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    if (next === "dark") document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
    localStorage.setItem("hei.theme", next);
    setThemeIcon();
    // Force a repaint of the listings after the theme attribute flip. Some
    // browsers occasionally drop card contents in the transition between
    // CSS-variable values when the attribute changes mid-paint; re-rendering
    // the active tab guarantees the cards land back on screen deterministically.
    try {
      const activeTab = document.querySelector("nav.tabs button.active")?.dataset.tab;
      if (activeTab === "listings") render();
      else if (activeTab === "saved") renderSaved();
      else if (activeTab === "vacancies") renderVacancies();
      else if (activeTab === "resources") renderResources();
    } catch (_) { /* fail open — the visual change is already applied */ }
  });

  // Only buttons that actually represent a panel (have data-tab) participate
  // in tab switching. The theme-toggle is also a <button> inside nav.tabs but
  // has no data-tab — without this guard, clicking it would hide every panel
  // because `btn.dataset.tab` is undefined and no panel name matches.
  // Switch to the named tab — used both by user clicks and by hash routing.
  // Returns true if `name` matched a real tab. The hash is updated only
  // when the caller asks (so initial-load activation doesn't push history).
  // All panels the activator knows about — for the show/hide loop.
  const ALL_PANELS = ["listings", "saved", "map", "vacancies", "resources", "coverage", "about"];

  function activateTab(name, { writeHash = false, focusTab = false } = {}) {
    const btn = document.querySelector(`nav.tabs button[data-tab="${name}"]`);
    if (!btn) return false;
    // Flip the visual class AND the WAI-ARIA state on the tablist tabs in
    // lockstep.
    document.querySelectorAll("nav.tabs button[data-tab]").forEach(b => {
      const isActive = (b === btn);
      b.classList.toggle("active", isActive);
      b.setAttribute("aria-selected", isActive ? "true" : "false");
      b.setAttribute("tabindex", isActive ? "0" : "-1");
    });
    if (focusTab) {
      btn.focus();
    }
    for (const n of ALL_PANELS) {
      const panel = document.getElementById(n + "-tab");
      if (panel) panel.style.display = (name === n) ? "" : "none";
    }
    // Filter strip is only meaningful on tabs that filter the ad corpus —
    // Vacancies (the listings feed) and Map. On The Gap, Resources, Saved,
    // and About the filters do nothing; showing them adds clutter and
    // implies they affect those views.
    const filterStrip = document.getElementById("filter-strip");
    if (filterStrip) {
      const filtersApply = (name === "listings" || name === "map");
      filterStrip.style.display = filtersApply ? "" : "none";
    }
    if (name === "map") { initMap(); render(); }
    if (name === "saved") renderSaved();
    if (name === "vacancies") renderVacancies();
    if (name === "resources") renderResources();
    if (writeHash) {
      // Use pushState so back/forward survive the deep-link.
      const hash = name === "listings" ? "" : `#${name}`;
      const url = location.pathname + location.search + hash;
      history.pushState({ tab: name }, "", url);
    }
    return true;
  }

  document.querySelectorAll("nav.tabs button[data-tab]").forEach(btn => {
    btn.addEventListener("click", () => activateTab(btn.dataset.tab, { writeHash: true }));
  });

  // WAI-ARIA tablist arrow-key navigation. Per
  // https://www.w3.org/WAI/ARIA/apg/patterns/tabs/, ArrowLeft/ArrowRight
  // moves between tabs (wrapping at the ends), Home jumps to the first tab,
  // End to the last. Activating a tab via arrow keys focuses AND switches —
  // the manual-activation pattern is allowed but the automatic-activation
  // pattern matches the existing click behaviour and feels more natural for
  // a small tablist where switching panels is cheap.
  const tablist = document.querySelector("nav.tabs[role=tablist]");
  if (tablist) {
    tablist.addEventListener("keydown", (e) => {
      const tabs = [...tablist.querySelectorAll('button[role="tab"]')];
      const i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      let next = -1;
      if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
      else if (e.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = tabs.length - 1;
      if (next < 0) return;
      e.preventDefault();
      activateTab(tabs[next].dataset.tab, { writeHash: true, focusTab: true });
    });
  }

  // Hash routing: deep links (#vacancies, #resources, #map, #saved, #about)
  // survive refresh, share, and the browser's back/forward buttons.
  // `listings` is the default and uses no hash. Unknown hashes (e.g.
  // #coverage when location.hash is a marketing anchor) are ignored.
  const VALID_TAB_HASHES = new Set(["listings","saved","map","vacancies","resources","about"]);
  function activateFromHash() {
    const h = location.hash.replace(/^#/, "");
    if (h === "coverage") return; // handled separately at load time
    const name = VALID_TAB_HASHES.has(h) ? h : "listings";
    activateTab(name, { writeHash: false });
  }
  // Run once on first wire-up (covers reload-into-#vacancies) and then on
  // every back/forward navigation.
  activateFromHash();
  window.addEventListener("hashchange", activateFromHash);
  window.addEventListener("popstate", activateFromHash);

  // In-page links that jump to a specific tab. Used by the vacancy-gap
  // banner ("See the breakdown by category →") and any other anchor with
  // a data-tab-link attribute. Triggers the same path as a tab click so
  // the panel renders correctly.
  //
  // Optional `data-scroll-target="<id>"` attribute scrolls to a named
  // anchor inside the destination tab after activation completes. We
  // wait one tick + a bit so async render functions (renderVacancies)
  // have a chance to insert the target element before scrollIntoView.
  document.body.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-tab-link]");
    if (!a) return;
    e.preventDefault();
    const tab = a.dataset.tabLink;
    const scrollTarget = a.dataset.scrollTarget;
    const ok = activateTab(tab, { writeHash: true });
    if (!ok) { location.href = a.href; return; }
    if (scrollTarget) {
      // 250ms covers the renderVacancies async fetch path on first hit;
      // subsequent hits resolve from the cached VACANCY_DATA and complete
      // sooner, but the timeout is harmless. If the target sits inside
      // any closed <details> elements (e.g. the bibliography or the
      // appendix), open them on the way up so the scroll lands at a
      // visible target instead of the collapsed summary.
      setTimeout(() => {
        const target = document.getElementById(scrollTarget);
        if (!target) return;
        let node = target;
        while (node && node !== document.body) {
          if (node.tagName === "DETAILS" && !node.open) node.open = true;
          node = node.parentElement;
        }
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 250);
    }
  });

  document.body.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-map-list-inst]");
    if (!a) return;
    e.preventDefault();
    const label = a.dataset.mapListLabel || "";
    setSearchValue(label, { mapListKey: a.dataset.mapListKey || a.dataset.mapListInst || "" });
    const ok = activateTab("listings", { writeHash: true });
    if (!ok) { location.href = a.href; return; }
    render();
    document.getElementById("feed")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

// ---------- filtering + sorting ----------
// Logic moved to lib/filters.js — currentFilterState, applyFilters,
// applySort, adPassesFilter, updateReactiveCounts, isReservedPost,
// filterHaystack, getChecked.

// ---------- render ----------
function render() {
  // Filters changed (or it's the first render) — reset progressive-load
  // counter so the user always lands on chunk 1, not mid-scroll into a
  // previously-loaded list. The load-more button itself bypasses render()
  // and calls renderAdList directly, so its bump survives.
  renderLimit = RENDER_PAGE_SIZE;
  const st = currentFilterState();
  document.querySelectorAll(".history-filter").forEach(el => { el.hidden = !window._includeArchive; });
  const filtered = applySort(applyFilters(st), st.sort);


  renderActiveFilters(st);
  renderSummary(filtered, st);
  renderAdList(filtered);
  updateSelCounts(st);
  updateReactiveCounts(st);
  // Tab badge counts advertisements, not collapsed cards — "Vacancies 73"
  // read as 73 positions when aggregation shrank the card count.
  document.getElementById("count-listings").textContent = filtered.length;
  document.getElementById("count-saved").textContent = SAVED.size > 0 ? SAVED.size : "";
  updateMapMarkers(filtered);
}

function renderActiveFilters(st) {
  const chips = [];
  // Field chips: collapse to a single summary chip when >3 are selected so
  // the chip bar stays readable. Click the summary expands inline.
  const fieldsArr = [...st.fields];
  const FIELD_COLLAPSE_THRESHOLD = 4;
  const fieldsCollapsed = fieldsArr.length > FIELD_COLLAPSE_THRESHOLD && !window._fieldsExpanded;
  if (fieldsCollapsed) {
    chips.push({ kind: "hss-summary", val: "", label: `Field × ${fieldsArr.length}` });
  } else {
    for (const v of fieldsArr) chips.push({ kind: "hss", val: v, label: v });
  }
  for (const v of st.statuses) chips.push({ kind: "quality", val: v, label: QUALITY_LABELS[v] || v });
  for (const v of st.lifecycleStatuses) chips.push({ kind: "lifecycle", val: v, label: LIFECYCLE_LABELS[v] || v });
  for (const v of st.types) chips.push({ kind: "type", val: v, label: typeLabel(v) });
  for (const v of st.posGroups) {
    const POS_LABEL = { faculty: "Asst Prof", associate: "Assoc Prof", full: "Full Prof", research: "Postdoc" };
    chips.push({ kind: "posgroup", val: v, label: POS_LABEL[v] || v });
  }
  for (const v of st.states) chips.push({ kind: "state", val: v, label: v });
  if (st.query) chips.push({ kind: "query", val: "", label: `"${st.query}"` });

  const c = document.getElementById("active-filters");
  if (!chips.length) { c.innerHTML = ""; return; }
  c.innerHTML = chips.map(ch => {
    if (ch.kind === "hss-summary") {
      // Summary chip: clicking the label expands; clicking × clears all fields.
      return `<span class="chip-active chip-summary" data-kind="hss-summary" title="Click to expand"><span class="grow">${escapeHTML(ch.label)} ▾</span><button type="button" data-kind="hss-clear" title="Clear all field selections" aria-label="Clear all field selections">×</button></span>`;
    }
    const removeLabel = `Remove filter: ${ch.label}`;
    return `<span class="chip-active">${escapeHTML(ch.label)}<button type="button" data-kind="${ch.kind}" data-val="${escapeAttr(ch.val)}" title="${escapeAttr(removeLabel)}" aria-label="${escapeAttr(removeLabel)}">×</button></span>`;
  }).join("") + `<button type="button" class="chip-clear" id="clear-filters">Clear all</button>`;

  // Expand-on-click for summary chip (clicking anywhere on chip except the ×).
  c.querySelectorAll(".chip-summary").forEach(chip => {
    chip.addEventListener("click", (e) => {
      if (e.target.tagName === "BUTTON") return;
      window._fieldsExpanded = true;
      render();
    });
  });

  c.querySelectorAll(".chip-active button").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const { kind, val } = btn.dataset;
      if (kind === "query") setSearchValue("");
      else if (kind === "hss-clear") {
        document.querySelectorAll("#filter-hss input").forEach(el => el.checked = false);
        window._fieldsExpanded = false;
      } else {
        const mapId = { hss: "filter-hss", quality: "filter-quality", lifecycle: "filter-lifecycle", type: "filter-type", posgroup: "filter-posgroup", state: "filter-state" }[kind];
        const box = document.querySelector(`#${mapId} input[value="${CSS.escape(val)}"]`);
        if (box) box.checked = false;
      }
      render();
    });
  });
  document.getElementById("clear-filters").addEventListener("click", () => {
    setSearchValue("");
    ["filter-hss","filter-quality","filter-lifecycle","filter-type","filter-posgroup","filter-state"].forEach(id =>
      document.querySelectorAll(`#${id} input`).forEach(el => el.checked = false));
    window._includeArchive = false;
    window._fieldsExpanded = false;
    render();
  });
}

function renderSummary(filtered, st) {
  const active = st.fields.size + st.statuses.size + st.lifecycleStatuses.size + st.types.size + st.posGroups.size + st.states.size + (st.query ? 1 : 0) + (window._includeArchive ? 1 : 0);
  const el = document.getElementById("summary-row");

  // Lead with what a reader actually asks: how many institutions are
  // hiring, for how many positions. number_of_posts is parsed from only
  // some ads, so the position figure is a floor (missing counts as 1).
  const instCount = new Set(filtered.map(a => a.institution_id).filter(Boolean)).size;
  const positionsFloor = filtered.reduce((n, a) => n + (a.number_of_posts || 1), 0);

  el.textContent = "";
  const emph = document.createElement("span");
  emph.className = "emph";
  emph.textContent = instCount;
  el.appendChild(emph);
  el.appendChild(document.createTextNode(` institution${instCount !== 1 ? "s" : ""} hiring for `));
  const emphPos = document.createElement("span");
  emphPos.className = "emph";
  emphPos.textContent = `${positionsFloor}+`;
  el.appendChild(emphPos);
  el.appendChild(document.createTextNode(" positions "));
  const muted = document.createElement("span");
  muted.style.color = "var(--muted-soft)";
  const activeTotal = state.ADS.filter(ad => lifecycleStatus(ad) === "active").length;
  const denominator = window._includeArchive ? state.ADS.length : activeTotal;
  muted.textContent = filtered.length === denominator
    ? `(${filtered.length} ${window._includeArchive ? "retained" : "live"} advertisement${filtered.length !== 1 ? "s" : ""})`
    : `(${filtered.length} advertisement${filtered.length !== 1 ? "s" : ""} of ${denominator}${window._includeArchive ? " retained" : " live"})`;
  el.appendChild(muted);
  if (active > 0) {
    el.appendChild(document.createTextNode(" "));
    const mark = document.createElement("span");
    mark.className = "active-mark";
    mark.textContent = `· ${active} filter${active !== 1 ? "s" : ""} active`;
    el.appendChild(mark);
  }
  document.getElementById("sr-announcer").textContent =
    `${instCount} institutions hiring for ${positionsFloor}+ positions, ${filtered.length} advertisements shown`;
  // Vacancy-gap pulse on the Vacancies tab. Numerator is hardcoded in
  // index.html (10,637 = 4,889 CU teaching + 5,748 AIIMS, the most
  // recent partial CFHEI disclosures). Denominator is currently-tracked
  // CFHEI ads — private-university listings are excluded so the ratio
  // doesn't understate the regression. The same gap is broken out on
  // The Gap tab (charts.js renderVacancies) with full math + sources.
  const adsEl = document.getElementById("vgb-ads");
  if (adsEl) {
    const cfheiAds = state.ADS.filter(a => {
      const inst = state.INSTITUTIONS[a.institution_id];
      return lifecycleStatus(a) === "active" && inst && inst.type !== "PrivateUniversity";
    }).length;
    adsEl.textContent = cfheiAds || "—";
  }
}

function updateSelCounts(st) {
  // Update each filter-strip trigger's pill: show count when ≥1 selection,
  // hide when 0. Also flag the parent .filter-dd as `has-active` so the
  // trigger button itself gets a coloured border state.
  const setPill = (id, n, dim) => {
    const pill = document.getElementById(id);
    if (!pill) return;
    pill.textContent = n;
    pill.hidden = n === 0;
    const dd = pill.closest(".filter-dd");
    if (dd) dd.classList.toggle("has-active", n > 0);
  };
  setPill("selcnt-hss",      st.fields.size,    "field");
  setPill("selcnt-quality",  st.statuses.size,  "quality");
  setPill("selcnt-lifecycle", st.lifecycleStatuses.size, "lifecycle");
  setPill("selcnt-archive", window._includeArchive ? 1 : 0, "archive");
  setPill("selcnt-type",     st.types.size,     "type");
  setPill("selcnt-posgroup", st.posGroups.size, "posgroup");
  setPill("selcnt-state",    st.states.size,    "state");
}

// Progressive-render limit. Default 25 — enough that filtered queries (which
// almost always return ≤25 anyway) render fully without a button, but the
// unfiltered 335-ad case is bounded so initial paint is fast and the user
// gets a clear "you're 25 of 335 in" indicator. Each "Load more" click bumps
// the limit by RENDER_PAGE_SIZE.
const RENDER_PAGE_SIZE = 25;
let renderLimit = RENDER_PAGE_SIZE;

function renderAdList(filtered) {
  const host = document.getElementById("feed-items");
  if (filtered.length === 0) {
    // When the user has the Reserved-posts quick-chip on and the result
    // is zero, the empty state is not "no match" — it's a finding. None
    // of the scraped ads disclose per-post reservation rosters; that
    // absence IS the political point. Surface it as such and link to
    // The Gap rather than silently rendering a generic empty.
    if (window._reservedOnly) {
      host.innerHTML = `
        <div class="empty-state empty-state-reserved">
          <div class="big">⚑</div>
          <div class="empty-state-headline">No advertisements currently disclose reservation breakdown.</div>
          <div class="empty-state-body">
            The current feed has no ads with per-post category counts or roster tables. Many ads cite reservation policy without publishing the operational roster.
          </div>
          <div class="empty-state-cta">
            <a href="#vacancies" data-tab-link="vacancies">See The Gap →</a>
          </div>
        </div>`;
    } else {
      host.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-headline">No advertisements match your filters.</div>
          <div class="empty-state-body">Try clearing the search phrase first, then broaden discipline or position filters.</div>
          <button type="button" class="empty-state-clear" id="empty-clear-filters">Clear filters</button>
        </div>`;
      document.getElementById("empty-clear-filters")?.addEventListener("click", () => {
        document.getElementById("search").value = "";
        ["filter-hss","filter-quality","filter-lifecycle","filter-type","filter-posgroup","filter-state"].forEach(id =>
          document.querySelectorAll(`#${id} input`).forEach(el => { el.checked = false; }));
        window._fieldsExpanded = false;
        window._reservedOnly = false;
        window._includeArchive = false;
        document.getElementById("chip-reserved")?.setAttribute("aria-pressed", "false");
        render();
      });
    }
    return;
  }
  // Group by institution_id to decide which groups get aggregated.
  // We keep filtered's existing order — the aggregate card replaces
  // the first occurrence of an aggregated institution, and subsequent
  // ads for the same institution are absorbed into the aggregate (and
  // suppressed from the flat stream).
  const byInst = new Map();
  for (const ad of filtered) {
    const id = ad.institution_id || "_unknown";
    if (!byInst.has(id)) byInst.set(id, []);
    byInst.get(id).push(ad);
  }
  const aggregatedIds = new Set();
  for (const [id, ads] of byInst) {
    if (ads.length >= INSTITUTION_AGGREGATE_THRESHOLD) aggregatedIds.add(id);
  }

  // Build the render stream: one entry per ad for non-aggregated
  // institutions, one entry per institution (at the position of its
  // first ad) for aggregated ones.
  const stream = [];
  const emittedAggregates = new Set();
  for (const ad of filtered) {
    const id = ad.institution_id || "_unknown";
    if (aggregatedIds.has(id)) {
      if (!emittedAggregates.has(id)) {
        emittedAggregates.add(id);
        stream.push({ kind: "aggregate", institutionId: id, ads: byInst.get(id) });
      }
    } else {
      stream.push({ kind: "ad", ad });
    }
  }

  const cap = Math.min(renderLimit, stream.length);
  const shown = stream.slice(0, cap);
  let html = shown.map(unit =>
    unit.kind === "aggregate"
      ? renderInstitutionAggregate(unit.institutionId, unit.ads)
      : renderAd(unit.ad)
  ).join("");
  // Pagination + footer text reference `stream.length` (renderable units —
  // an aggregate counts as one unit even when it represents many ads),
  // while the "advertisements total" annotation still cites filtered.length
  // so the user can see how many underlying postings the aggregates represent.
  const adsTotal = filtered.length;
  const unitsTotal = stream.length;
  if (cap < unitsTotal) {
    const remaining = unitsTotal - cap;
    const nextChunk = Math.min(RENDER_PAGE_SIZE, remaining);
    html += `<button class="load-more" id="load-more-btn" type="button">
      Showing 1–${cap} of ${unitsTotal} <span class="lm-sub">— load ${nextChunk} more ▾</span>
    </button>`;
  } else if (unitsTotal > RENDER_PAGE_SIZE || adsTotal !== unitsTotal) {
    html += `<div class="load-more-done">Showing all ${unitsTotal} ${unitsTotal === 1 ? "card" : "cards"}${adsTotal !== unitsTotal ? ` (${adsTotal} advertisements total — some institutions grouped)` : ""}.</div>`;
  }
  host.innerHTML = html;
  wireAdActions(host);
  const btn = document.getElementById("load-more-btn");
  if (btn) {
    btn.addEventListener("click", () => {
      renderLimit += RENDER_PAGE_SIZE;
      renderAdList(filtered);
    });
  }
}


// ---------- map ----------
// initMap, updateMapMarkers, MARKERS, typeLabel — all moved to lib/map.js.

loadData();

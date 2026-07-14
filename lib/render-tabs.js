// docs/lib/render-tabs.js — HTML builders for the Resources, Saved, and
// Coverage tabs. Each is a single function that paints into a fixed host
// div by id; none of them carry mutable state of their own.
//
// renderResources is the longest because its block layout has multiple
// special cases (postdocs-abroad sub-grouped legend, the unified
// Indian-institutions block with embedded RTI templates, then the
// remaining flat blocks). Resources data itself lives in lib/charts.js
// (POSTDOC_ABROAD, RTI_TEMPLATES, RESOURCES_BLOCKS).
//
// renderSaved + renderCoverage are simpler: a sort + map over the
// relevant slice of state (state.SAVED ids, state.COVERAGE rows).

import { state } from "./state.js";
import { escapeHTML, escapeAttr, safeUrl } from "./sanitize.js";
import {
  POSTDOC_ABROAD, RTI_TEMPLATES, RESOURCES_BLOCKS,
} from "./charts.js";
import { daysUntil } from "./card-helpers.js";
import { renderAd, wireAdActions } from "./render-card.js";

export function renderResources() {
  const host = document.getElementById("resources-tab");

  // Helper: render a single list item the same way for both flat and
  // sub-grouped block schemas. If the item carries an `elig` annotation
  // (citizenship/residency status), surface it as a coloured chip next
  // to the link so the applicant sees the eligibility verdict at a
  // glance — this matters because several Canadian/UK/US programmes
  // exclude Indian-PhD applicants at the door.
  const eligChip = (e) => e
    ? `<span class="elig elig-${escapeAttr(e.status)}">${escapeHTML(e.label)}</span>`
    : "";
  const regionChip = (r) => r
    ? `<span class="region">${escapeHTML(r)}</span>`
    : "";
  const getDiscipline = (str) => {
    const s = str.toLowerCase();
    if (s.includes('stem') || s.includes('lab sciences') || s.includes('life sciences') || s.includes('theoretical sciences') || s.includes('engineering')) return 'STEM';
    if (s.includes('humanities') || s.includes('liberal arts') || s.includes('philosophy') || s.includes('literature') || s.includes('humanistic')) return 'Humanities';
    if (s.includes('social') || s.includes('ssh') || s.includes('anthropology') || s.includes('sociology') || s.includes('policy') || s.includes('development') || s.includes('political') || s.includes('area studies') || s.includes('international relations') || s.includes('economics') || s.includes('law')) return 'Social Sciences';
    return 'All';
  };

  const renderItem = (i) => {
    const disc = getDiscipline((i.name + " " + (i.note || "")));
    return `
    <li class="postdoc-item" data-region="${escapeAttr(i.region || 'Any')}" data-elig="${escapeAttr(i.elig?.status || 'any')}" data-discipline="${escapeAttr(disc)}">
      <div class="postdoc-card-head">
        ${i.url && i.url !== "#"
          ? `<a href="${escapeAttr(safeUrl(i.url))}" target="_blank" rel="noopener noreferrer">${escapeHTML(i.name)} <span class="ext">↗</span></a>`
          : `<span class="res-name">${escapeHTML(i.name)}</span>`}
      </div>
      ${(i.region || i.elig) ? `<div class="postdoc-card-meta">${regionChip(i.region)}${eligChip(i.elig)}</div>` : ""}
      <div class="res-note">${escapeHTML(i.note)}</div>
    </li>`;
  };

  // Postdocs-abroad block — sub-grouped, with raw HTML in the intro
  // (controlled, hand-authored — not user input — so the manual <p> and
  // <a> tags are intentional). Renders first because the page's editorial
  // recommendation to Bahujan PhDs is explicitly to apply abroad rather
  // than wait for the Indian state to administer the constitution.
  const postdocBlock = `
    <details class="res-accordion ${escapeAttr(POSTDOC_ABROAD.cls)}">
      <summary>
        <span class="acc-title">I am looking for postdoctoral fellowships abroad</span>
        <span class="acc-icon">▾</span>
      </summary>
      <div class="acc-content">
        <div class="res-block-intro">${POSTDOC_ABROAD.intro}</div>
        <div class="postdoc-guide" role="note">
          <div><strong>Read eligibility first.</strong> Region is location; eligibility is the gate. Verify the current call before drafting.</div>
          <div class="postdoc-guide-key" aria-label="Eligibility key">
            <span class="elig elig-open">Indian PhDs eligible</span>
            <span class="elig elig-caveat">Open with caveat</span>
            <span class="elig elig-restricted">Restricted</span>
            <span class="elig elig-varies">Varies / verify</span>
          </div>
        </div>
        <details class="postdoc-norms">
          <summary>Regional application norms</summary>
          <dl>
            <div><dt>UK / EU / Australia</dt><dd>PhD usually must be in hand by the application deadline. Time-since-PhD limits are common.</dd></div>
            <div><dt>US / Canada</dt><dd>Some programmes accept final-year PhDs if the defence is completed before the fellowship starts.</dd></div>
            <div><dt>Mobility rules</dt><dd>Marie Curie and Newton International restrict recent residence in the host country.</dd></div>
            <div><dt>Letters</dt><dd>Three recommendations are standard. Plan early.</dd></div>
          </dl>
        </details>
        <div class="postdoc-filters">
          <label>Filter by Region: 
            <select id="filter-region">
              <option value="All">All Regions</option>
              <option value="North America">North America</option>
              <option value="Europe & UK">Europe & UK</option>
              <option value="Asia & Oceania">Asia & Oceania</option>
              <option value="Multi">Multi-Region</option>
            </select>
          </label>
          <label>Discipline: 
            <select id="filter-discipline">
              <option value="All">All Disciplines</option>
              <option value="Humanities">Humanities</option>
              <option value="Social Sciences">Social Sciences</option>
              <option value="STEM">STEM</option>
            </select>
          </label>
          <label>Eligibility: 
            <select id="filter-elig">
              <option value="All">Any Eligibility</option>
              <option value="open">Indian PhDs Eligible</option>
              <option value="caveat">Open with Caveat</option>
              <option value="restricted">Restricted</option>
            </select>
          </label>
        </div>
        ${POSTDOC_ABROAD.subgroups.map(g => `
          <div class="postdoc-subgroup">
            <h4>${escapeHTML(g.title)}</h4>
            <ul>${g.items.map(renderItem).join("")}</ul>
          </div>`).join("")}
      </div>
    </details>`;

  // Combined Indian-institutions block — practical-infrastructure
  // links and RTI templates are conceptually the same thing (both
  // serve the candidate applying within India). Rendered as one
  // unified block with two subsections under a single heading.
  const indianBlockData = RESOURCES_BLOCKS[0];
  const indianBlock = `
    <details class="res-accordion rti-block">
      <summary>
        <span class="acc-title">I am applying to Indian institutions</span>
        <span class="acc-icon">▾</span>
      </summary>
      <div class="acc-content">
        <p class="res-block-intro">Application infrastructure, complaint forums, parliamentary-question search, and RTI templates for data institutions do not publish.</p>
        <h4 class="rti-subhead">Application infrastructure</h4>
        <ul class="indian-link-list">${indianBlockData.items.map(renderItem).join("")}</ul>
        <h4 class="rti-subhead">RTI templates for missing data</h4>
        <p class="rti-subnote">Four templates for common disclosure gaps. Replace bracketed placeholders and send the request to the institution's Public Information Officer. RTIs usually cost ₹10; institutions must respond within 30 days.</p>
        <div class="rti-grid">
          ${RTI_TEMPLATES.map((t, i) => `
            <details class="rti-card">
              <summary>
                <span class="rti-title">${escapeHTML(t.title)}</span>
                <span class="rti-expand">show template ▾</span>
              </summary>
              <div class="rti-body">
                <p class="rti-scenario">${escapeHTML(t.scenario)}</p>
                <div class="rti-target"><strong>To:</strong> ${escapeHTML(t.target)}</div>
                <textarea class="rti-text" id="rti-text-${i}" readonly rows="14">${escapeHTML(t.body)}</textarea>
                <div class="rti-actions">
                  <button class="rti-copy" data-target="rti-text-${i}" type="button">Copy template</button>
                  <a class="rti-online" href="https://rtionline.gov.in/" target="_blank" rel="noopener">File on RTI Online ↗</a>
                </div>
              </div>
            </details>`).join("")}
        </div>
      </div>
    </details>`;

  const renderBlock = (b) => `
    <details class="res-accordion res-block">
      <summary>
        <span class="acc-title">I am exploring ${escapeHTML(b.title.toLowerCase().replace("if you're tracking ", ""))}</span>
        <span class="acc-icon">▾</span>
      </summary>
      <div class="acc-content">
        <ul>${b.items.map(renderItem).join("")}</ul>
      </div>
    </details>`;

  const networksBlock = renderBlock(RESOURCES_BLOCKS[1]);
  const accountabilityBlock = renderBlock(RESOURCES_BLOCKS[2]);

  host.innerHTML = `
    <div class="res-intro">
      <h2>Resources for candidates</h2>
      <p>Tools for Bahujan PhD scholars: postdoctoral routes abroad, Indian application infrastructure, RTI templates, and networks. Use alongside the <a href="#vacancies" data-tab-link="vacancies" style="color:var(--accent); font-weight:600;">Vacancies tab</a>.</p>
    </div>
    ${postdocBlock}
    ${networksBlock}
    ${indianBlock}
    ${accountabilityBlock}
  `;

  // Wire copy-to-clipboard for each template.
  host.querySelectorAll(".rti-copy").forEach(btn => {
    btn.addEventListener("click", async () => {
      const ta = host.querySelector(`#${btn.dataset.target}`);
      if (!ta) return;
      try {
        await navigator.clipboard.writeText(ta.value);
        const orig = btn.textContent;
        btn.textContent = "✓ Copied";
        btn.classList.add("copied");
        setTimeout(() => { btn.textContent = orig; btn.classList.remove("copied"); }, 1800);
      } catch {
        // Fallback: select the textarea so user can manually copy.
        ta.select();
      }
    });
  });

  // Wire up scaffolding filters for Postdocs
  const filterPostdocs = () => {
    const reg = host.querySelector("#filter-region")?.value || "All";
    const disc = host.querySelector("#filter-discipline")?.value || "All";
    const elig = host.querySelector("#filter-elig")?.value || "All";
    
    host.querySelectorAll(".postdoc-subgroup").forEach(sub => {
      let visibleCount = 0;
      sub.querySelectorAll(".postdoc-item").forEach(item => {
        const matchReg = reg === "All" || item.dataset.region === reg || item.dataset.region === "Multi";
        const matchDisc = disc === "All" || item.dataset.discipline === disc || item.dataset.discipline === "All";
        const matchElig = elig === "All" || item.dataset.elig === elig;
        
        if (matchReg && matchDisc && matchElig) {
          item.style.display = "";
          visibleCount++;
        } else {
          item.style.display = "none";
        }
      });
      // Hide subgroup if all items are hidden
      sub.style.display = visibleCount === 0 ? "none" : "";
    });
  };

  host.querySelector("#filter-region")?.addEventListener("change", filterPostdocs);
  host.querySelector("#filter-discipline")?.addEventListener("change", filterPostdocs);
  host.querySelector("#filter-elig")?.addEventListener("change", filterPostdocs);
}

export function renderSaved() {
  const host = document.getElementById("saved-tab");
  const savedAds = state.ADS.filter(a => state.SAVED.has(a.id));
  if (savedAds.length === 0) {
    host.innerHTML = `<div class="empty-state"><div class="big">☆</div><div>No saved advertisements yet.</div><div style="font-size:13px; margin-top:4px;">Star a listing to add it here.</div></div>`;
    return;
  }
  const sorted = [...savedAds].sort((a,b) => (daysUntil(a.closing_date) ?? 9999) - (daysUntil(b.closing_date) ?? 9999));
  host.innerHTML =
    `<div style="font-size:13px; color:var(--muted); margin-bottom:12px;">${sorted.length} saved advertisement${sorted.length!==1?"s":""}</div>` +
    `<div class="feed-list">${sorted.map(renderAd).join("")}</div>`;
  wireAdActions(host);
}

export function renderCoverage() {
  if (!state.COVERAGE) {
    document.getElementById("coverage-summary").innerHTML = `<p style="color:var(--muted)">No coverage report available yet.</p>`;
    return;
  }
  const s = state.COVERAGE;
  const ok = (s.rows || []).filter(r => r.fetch_status === "ok").length;
  const stub = (s.rows || []).filter(r => r.fetch_status === "rolling-stub").length;
  const stale = (s.rows || []).filter(r => r.fetch_status === "stale-archive").length;
  const err = (s.rows || []).filter(r => !["ok", "rolling-stub", "stale-archive", "manual"].includes(r.fetch_status)).length;
  document.getElementById("coverage-summary").innerHTML = `
    <div class="kpi-grid">
      <div class="kpi"><div class="lbl">Attempted</div><div class="val" style="color:var(--muted)">${s.institutions_attempted}</div></div>
      <div class="kpi"><div class="lbl">Scraped</div><div class="val" style="color:var(--good)">${ok}</div></div>
      <div class="kpi"><div class="lbl">Rolling calls</div><div class="val" style="color:var(--warn)">${stub}</div></div>
      <div class="kpi"><div class="lbl">Carried forward</div><div class="val" style="color:var(--warn)">${stale}</div></div>
      <div class="kpi"><div class="lbl">Needs attention</div><div class="val" style="color:var(--alarm)">${err}</div></div>
      <div class="kpi"><div class="lbl">Total ads</div><div class="val" style="color:var(--accent)">${s.ads_found_total}</div></div>
    </div>
    <p style="font-size:12px; color:var(--muted); margin-bottom:10px;">Run generated at <span style="font-family:var(--mono)">${escapeHTML(s.generated_at)}</span></p>`;
  const tbody = document.querySelector("#coverage-table tbody");
  const statusRank = { "parser-error": 0, "network-error": 1, "http-error": 2, "robots-blocked": 3, "no-url": 4, "stale-archive": 5, "rolling-stub": 6, "manual": 7, "ok": 8 };
  const shown = [...(s.rows || [])].sort((a,b) => (statusRank[a.fetch_status] ?? 4) - (statusRank[b.fetch_status] ?? 4));
  tbody.innerHTML = shown.map(r => {
    const inst = state.INSTITUTIONS[r.institution_id] || { name: r.institution_id };
    const cls = r.fetch_status === "ok" ? "status-ok" : (r.fetch_status === "manual" || r.fetch_status === "rolling-stub" || r.fetch_status === "stale-archive" || r.fetch_status === "no-url" ? "status-no" : "status-err");
    return `<tr>
      <td>${escapeHTML(inst.name || r.institution_id)}</td>
      <td style="font-family:var(--mono); font-size:12px; color:var(--muted)">${escapeHTML(r.parser)}</td>
      <td class="${cls}">${escapeHTML(r.fetch_status)}</td>
      <td>${r.http_status ?? "—"}</td>
      <td style="text-align:right; font-family:var(--mono)">${r.ads_found}</td>
      <td style="color:var(--muted); font-size:12px;">${escapeHTML(r.note || "")}</td>
    </tr>`;
  }).join("");
}

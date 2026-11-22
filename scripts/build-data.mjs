// Pulls the Next Steps dashboard data from Planning Center and writes data.json.
// Runs weekly in GitHub Actions (see .github/workflows/refresh.yml).
// Needs two secrets: PCO_APP_ID and PCO_SECRET (a Planning Center Personal Access Token).
//
//   node scripts/build-data.mjs              -> live pull from Planning Center
//   node scripts/build-data.mjs fixture.json -> rebuild from saved raw data (for testing)

import { readFile, writeFile } from "node:fs/promises";

// ---------- Settings you may want to change ----------
export const CAMPUSES = {
  portage: { id: "13654", name: "Portage" },
  richland: { id: "14181", name: "Richland" },
};
const WNAR_MATCH = /wednesday night at radiant/i;
const BAPTISM_MATCH = /baptism/i;
const DEDICATION_MATCH = /dedication/i;
const BE_RADIANT_MATCH = /be radiant/i;
const GROUP_TYPES = ["Gather", "Grow", "Go"]; // other group types are ignored
const CATEGORIES = ["Men", "Women", "Young Adult", "Mixed"];
// Category comes from the group name. First match wins, so Young Adult beats Men/Women.
const CATEGORY_RULES = [
  ["Young Adult", /young adult|college|young women|young men|young professional/i],
  ["Women", /\bwom[ae]n|\bsisters\b|\bmoms?\b|\bmothers?\b|\bladies\b/i],
  ["Men", /\bmen\b|\bmen['’]?s\b|\bfathers?\b|\bbrothers\b/i],
];
// ------------------------------------------------------

const API = "https://api.planningcenteronline.com";

async function pcoGetAll(path) {
  const auth = Buffer.from(`${process.env.PCO_APP_ID}:${process.env.PCO_SECRET}`).toString("base64");
  let url = API + path;
  const out = { data: [], included: [] };
  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after") || 20);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`Planning Center ${res.status} on ${url}: ${await res.text()}`);
    const page = await res.json();
    out.data.push(...(Array.isArray(page.data) ? page.data : [page.data]));
    out.included.push(...(page.included || []));
    url = page.links?.next || null;
  }
  return out;
}

async function pullRaw() {
  const missing = ["PCO_APP_ID", "PCO_SECRET"].filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`GitHub didn't pass ${missing.join(" and ")} to the job. Add them under ` +
      `Settings → Secrets and variables → Actions → Secrets tab → "New repository secret" (not Variables, Codespaces or Dependabot).`);
  }
  const signups = await pcoGetAll(
    "/registrations/v2/signups?filter=unarchived&include=campuses,next_signup_time&per_page=100"
  );
  const wanted = signups.data.filter((s) => WNAR_MATCH.test(s.attributes.name));
  const selectionTypes = {};
  const attendees = {};
  for (const s of wanted) {
    selectionTypes[s.id] = (await pcoGetAll(`/registrations/v2/signups/${s.id}/selection_types?per_page=100`)).data;
    attendees[s.id] = (await pcoGetAll(`/registrations/v2/signups/${s.id}/attendees?per_page=100&include=selection_type`)).data;
  }
  const groups = await pcoGetAll(
    "/groups/v2/groups?per_page=100&include=group_type&where[archive_status]=not_archived"
  );
  return { signups, selectionTypes, attendees, groups };
}

// ---------- Pure transform: raw Planning Center data -> dashboard data ----------
export function build(raw, now = new Date()) {
  const warnings = [];
  const inc = new Map(raw.signups.included.map((r) => [`${r.type}:${r.id}`, r]));
  const startOf = (s) => {
    const ref = s.relationships?.next_signup_time?.data;
    const t = ref && inc.get(`SignupTime:${ref.id}`);
    return t ? new Date(t.attributes.starts_at) : null;
  };
  const campusIds = (s) => (s.relationships?.campuses?.data || []).map((c) => String(c.id));
  const forCampus = (s, id) => campusIds(s).length === 0 || campusIds(s).includes(id);
  const regUrl = (s) => s.attributes.new_registration_url || null;

  const nextEvent = (match, label, campus) => {
    const hits = raw.signups.data
      .filter((s) => match.test(s.attributes.name) && forCampus(s, campus.id))
      .map((s) => ({ s, start: startOf(s) }))
      .filter((x) => x.start && x.start > now)
      .sort((a, b) => a.start - b.start);
    if (!hits.length) {
      warnings.push(`${campus.name}: no upcoming ${label} date in Planning Center Registrations (screen shows "coming soon").`);
      return null;
    }
    const { s, start } = hits[0];
    return { date: start.toISOString(), name: s.attributes.name.trim(), open: !!s.attributes.open, url: regUrl(s) };
  };

  const campuses = {};
  for (const [key, campus] of Object.entries(CAMPUSES)) {
    // WNAR: the term for this campus that starts soonest in the future
    // (if none, the one most recently started).
    const terms = raw.signups.data
      .filter((s) => WNAR_MATCH.test(s.attributes.name) && campusIds(s).includes(campus.id))
      .map((s) => ({ s, start: startOf(s) }))
      .filter((x) => x.start);
    const future = terms.filter((x) => x.start > now).sort((a, b) => a.start - b.start);
    const past = terms.filter((x) => x.start <= now).sort((a, b) => b.start - a.start);
    const pick = future[0] || past[0];
    let wnar = null;
    if (!pick) {
      warnings.push(`${campus.name}: no WNAR term found in Registrations.`);
    } else {
      const { s, start } = pick;
      const tag = new RegExp(`^\\s*\\[${campus.name}\\]\\s*`, "i");
      // Seats taken = registrations per class that aren't canceled or waitlisted.
      const taken = {};
      for (const a of raw.attendees?.[s.id] || []) {
        if (a.attributes?.canceled === true || a.attributes?.waitlisted === true) continue;
        const st = a.relationships?.selection_type?.data?.id;
        if (st) taken[st] = (taken[st] || 0) + 1;
      }
      const seatsLeft = (t) =>
        typeof t.attributes.available_capacity === "number"
          ? t.attributes.available_capacity
          : t.attributes.maximum_capacity - (taken[t.id] || 0);
      const classes = (raw.selectionTypes[s.id] || [])
        .filter((t) => t.attributes.publicly_available && (t.attributes.maximum_capacity || 0) > 0)
        .filter((t) => !/^\s*\[[^\]]+\]/.test(t.attributes.name) || tag.test(t.attributes.name))
        .map((t) => {
          const name = t.attributes.name.replace(/^\s*\[[^\]]+\]\s*/, "").replace(/\s+/g, " ").trim();
          const section = /childcare|nursery/i.test(name) ? "Childcare" : /kids/i.test(name) ? "Kids" : "Adults";
          if (/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.? (3[2-9]|[4-9]\d)\b/i.test(name))
            warnings.push(`${campus.name}: class name "${name}" has a date that doesn't exist — check it in Registrations.`);
          return {
            name: name.replace(/^(Kids Discipleship|Childcare):\s*/i, ""),
            section,
            capacity: t.attributes.maximum_capacity,
            available: Math.max(0, seatsLeft(t)),
            waitlist: !!t.attributes.waitlist,
          };
        });
      if (!classes.length) warnings.push(`${campus.name}: WNAR term "${s.attributes.name}" has no live classes.`);
      const term = s.attributes.name.split("|").pop().replace(new RegExp(campus.name, "i"), "").replace(/\s*-\s*/g, " – ").replace(/\s+/g, " ").trim();
      wnar = { term, starts: start.toISOString(), open: !!s.attributes.open, url: regUrl(s), classes };
    }
    campuses[key] = {
      name: campus.name,
      wnar,
      baptism: nextEvent(BAPTISM_MATCH, "baptism", campus),
      beRadiant: nextEvent(BE_RADIANT_MATCH, "Be Radiant class", campus),
      dedication: nextEvent(DEDICATION_MATCH, "child dedication", campus),
    };
  }

  // Groups: church-wide counts by type and category.
  const typeName = new Map(
    raw.groups.included.filter((r) => r.type === "GroupType").map((r) => [String(r.id), r.attributes.name])
  );
  const types = GROUP_TYPES.map((name) => ({ name, total: 0, breakdown: Object.fromEntries(CATEGORIES.map((c) => [c, 0])) }));
  for (const g of raw.groups.data) {
    if (g.attributes?.archived_at) continue;
    const t = types.find((x) => x.name === typeName.get(String(g.relationships?.group_type?.data?.id)));
    if (!t) continue;
    const cat = (CATEGORY_RULES.find(([, re]) => re.test(g.attributes.name)) || ["Mixed"])[0];
    t.total += 1;
    t.breakdown[cat] += 1;
  }
  const groupsTotal = types.reduce((n, t) => n + t.total, 0);
  if (!groupsTotal) warnings.push("No active Gather/Grow/Go groups found.");

  return { generatedAt: now.toISOString(), campuses, groups: { total: groupsTotal, types }, warnings };
}

// ---------- Run ----------
if (import.meta.url === `file://${process.argv[1]}`) {
  const fixture = process.argv[2];
  const raw = fixture ? JSON.parse(await readFile(fixture, "utf8")) : await pullRaw();
  const now = process.env.NOW ? new Date(process.env.NOW) : new Date();
  const data = build(raw, now);
  await writeFile(new URL("../data.json", import.meta.url), JSON.stringify(data, null, 2) + "\n");
  console.log(`Wrote data.json: ${data.groups.total} groups, ` +
    Object.values(data.campuses).map((c) => `${c.name} ${c.wnar?.classes.length ?? 0} classes`).join(", "));
  if (data.warnings.length) {
    console.log("\nThings to check:");
    for (const w of data.warnings) console.log(" - " + w);
    if (process.env.GITHUB_STEP_SUMMARY) {
      await writeFile(process.env.GITHUB_STEP_SUMMARY,
        "### Next Steps dashboard — things to check\n" + data.warnings.map((w) => `- ${w}`).join("\n") + "\n", { flag: "a" });
    }
  }
}

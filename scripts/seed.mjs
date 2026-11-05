#!/usr/bin/env node
/**
 * TempoTrack demo data seeder.
 *
 * Creates fake (but realistic) Italian employees, time-off requests, holidays,
 * compensatory-day move requests and notifications, so the app can be shown
 * without any real company data.
 *
 * Usage:
 *   pnpm seed            # add demo data
 *   pnpm seed --reset    # wipe existing demo data first, then seed
 *   pnpm seed --dry-run  # generate everything in memory and write it to
 *                        # scripts/seed-preview.json (no Firebase needed)
 *
 * Target project:
 *   - Firebase Emulator: set FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST
 *     (e.g. 127.0.0.1:8080 and 127.0.0.1:9099) plus GCLOUD_PROJECT.
 *   - Real project: set GOOGLE_APPLICATION_CREDENTIALS to a service-account key
 *     of YOUR demo Firebase project (never commit that file).
 *
 * Demo login password comes from NEXT_PUBLIC_DEMO_PASSWORD in .env.local
 * (the same value the login page's demo buttons use).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { fakerIT as faker } from "@faker-js/faker";
import {
  addDays, addMonths, eachDayOfInterval, format,
  getWeek, parseISO, startOfMonth, startOfWeek, subDays, subMonths,
} from "date-fns";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
loadEnvFile(resolve(process.cwd(), ".env.local"));

const RESET = process.argv.includes("--reset");
const DRY_RUN = process.argv.includes("--dry-run");
const DEMO_DOMAIN = "example.com"; // reserved domain: never a real mailbox
const DEMO_PASSWORD = process.env.NEXT_PUBLIC_DEMO_PASSWORD;
const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const RANDOM_EMPLOYEES = 24;

if (!DRY_RUN && (!DEMO_PASSWORD || DEMO_PASSWORD.length < 6)) {
  fail("Set NEXT_PUBLIC_DEMO_PASSWORD (min 6 chars) in .env.local before seeding.");
}
if (!DRY_RUN && !PROJECT_ID) {
  fail("Set NEXT_PUBLIC_FIREBASE_PROJECT_ID in .env.local (or GCLOUD_PROJECT).");
}

// Same deterministic data on every run.
faker.seed(20251104);

// Keep in sync with src/lib/constants.ts (the app seeds the same list on first run)
const DEPARTMENTS = ["Vendite", "Direzione", "Back Office", "Amministrazione", "Marketing", "Customer Care", "Logistica", "Assistenza Tecnica"];
const DAY_IDS = ["DOM", "LUN", "MAR", "MER", "GIO", "VEN", "SAB"]; // index = Date#getDay()
const STATUS = { PENDING: "In Sospeso", APPROVED: "Approvato", REJECTED: "Rifiutato" };

// Weighted leave types (how often each shows up in the demo).
const FULL_DAY_TYPES = [
  ["Ferie", 40], ["Malattia", 14], ["Recupero Straordinari", 8], ["Ex Festività", 5],
  ["Permesso per Formazione", 4], ["Lutto", 1], ["Legge 104", 2], ["Permesso di studio", 2],
  ["Assenza non Retribuita", 1], ["Permesso per Donazione del Sangue", 1],
];
const UNPLANNED_TYPES = new Set(["Malattia", "Lutto", "Infortunio"]);
const PARTIAL_DAY_TYPES = [["ROL", 10], ["Permesso non retribuito", 2], ["Recupero Straordinari", 3], ["Permesso di studio", 1]];

// ---------------------------------------------------------------------------
// Firebase
// ---------------------------------------------------------------------------
const usingEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const preview = {}; // dry-run output: { "collection/path": { docId: data } }
let auth, db;
if (DRY_RUN) {
  ({ auth, db } = createDryRunBackend(preview));
} else {
  initializeApp(usingEmulator ? { projectId: PROJECT_ID } : { credential: applicationDefault(), projectId: PROJECT_ID });
  auth = getAuth();
  db = getFirestore();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const today = new Date();
const windowStart = startOfMonth(subMonths(today, 6));
const windowEnd = addMonths(today, 3);

console.log(DRY_RUN ? "Dry run: generating demo data in memory..." : `Seeding project "${PROJECT_ID}"${usingEmulator ? " (emulator)" : ""}...`);
if (RESET) await resetDemoData();

const holidaysByYear = buildHolidays([windowStart.getFullYear(), today.getFullYear(), windowEnd.getFullYear()]);
await writeHolidays(holidaysByYear);
await writeDepartments();

const users = await createUsers();
const requests = await createTimeOffRequests(users, holidaysByYear);
const moves = await createCompensatoryMoves(users);
const notifications = await createNotifications(users, requests);

if (DRY_RUN) {
  const out = resolve(process.cwd(), "scripts", "seed-preview.json");
  writeFileSync(out, JSON.stringify(preview, (_k, v) => (v instanceof Timestamp ? v.toDate().toISOString() : v), 2));
  console.log(`\nPreview written to ${out}`);
}
console.log(`\nDone: ${users.length} users, ${requests.length} time-off requests, ${moves} move requests, ${notifications} notifications.`);
console.log(`Demo accounts: demo.hr@${DEMO_DOMAIN}, demo.admin@${DEMO_DOMAIN}, demo.user@${DEMO_DOMAIN} (password from NEXT_PUBLIC_DEMO_PASSWORD).`);
process.exit(0);

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
async function createUsers() {
  const specs = [
    { key: "hr", email: `demo.hr@${DEMO_DOMAIN}`, firstName: "Giulia", lastName: "Ferri", role: "hr", department: "Amministrazione" },
    { key: "admin", email: `demo.admin@${DEMO_DOMAIN}`, firstName: "Marco", lastName: "Galli", role: "admin", department: "Direzione", managedDepartments: ["Vendite", "Customer Care", "Marketing"] },
    { key: "user", email: `demo.user@${DEMO_DOMAIN}`, firstName: "Luca", lastName: "Bianchi", role: "user", department: "Vendite" },
    { key: "admin2", firstName: "Sara", lastName: "Conti", role: "admin", department: "Logistica", managedDepartments: ["Logistica", "Assistenza Tecnica", "Back Office"] },
  ];

  for (let i = 0; i < RANDOM_EMPLOYEES; i++) {
    const sex = faker.person.sexType();
    specs.push({
      firstName: faker.person.firstName(sex),
      lastName: faker.person.lastName(),
      role: "user",
      department: DEPARTMENTS[i % DEPARTMENTS.length],
    });
  }
  // One external consultant, hidden from planner/timesheets via excludeFromPlanning.
  specs.push({ firstName: "Paolo", lastName: "Esposito", role: "user", department: "Nessuno", excludeFromPlanning: true });

  const created = [];
  const usedEmails = new Set();
  for (const spec of specs) {
    let email = spec.email ?? `${slug(spec.firstName)}.${slug(spec.lastName)}@${DEMO_DOMAIN}`;
    for (let n = 2; usedEmails.has(email); n++) email = `${slug(spec.firstName)}.${slug(spec.lastName)}${n}@${DEMO_DOMAIN}`;
    usedEmails.add(email);

    const schedule = pickSchedule(spec);
    const profile = {
      firstName: spec.firstName,
      lastName: spec.lastName,
      email,
      department: spec.department,
      role: spec.role,
      contactEmail: `${slug(spec.firstName)}.${slug(spec.lastName)}@personal.${DEMO_DOMAIN}`,
      cellphone: `+39 3${faker.string.numeric(2)} ${faker.string.numeric(3)} ${faker.string.numeric(4)}`,
      status: "active",
      compleanno: format(faker.date.birthdate({ mode: "age", min: 23, max: 62 }), "yyyy-MM-dd"),
      ...schedule,
      ...(spec.role === "admin" ? { managedDepartments: spec.managedDepartments ?? [] } : {}),
      ...(spec.excludeFromPlanning ? { excludeFromPlanning: true } : {}),
    };

    const uid = await upsertAuthUser(email, `${spec.firstName} ${spec.lastName}`);
    await auth.setCustomUserClaims(uid, { role: spec.role });
    await db.collection("users").doc(uid).set(profile);
    created.push({ uid, key: spec.key, ...profile });
  }
  console.log(`  users: ${created.length}`);
  return created;
}

function pickSchedule(spec) {
  const r = spec.key ? 0 : faker.number.float();
  const base = { workStartTime: "09:00", workEndTime: "18:00", lunchStartTime: "13:00", lunchEndTime: "14:00" };
  const weekdays = ["LUN", "MAR", "MER", "GIO", "VEN"];

  if (r < 0.65) {
    // Full time, Monday-Friday, 8h
    return { ...base, workSchedule: weekdays.map(day => ({ day, hours: 8 })) };
  }
  if (r < 0.85) {
    // Six-day week with a weekly compensatory afternoon off (retail / workshop style)
    const compDay = faker.helpers.arrayElement(["MER", "GIO"]);
    return {
      ...base,
      workSchedule: [...weekdays.map(day => ({ day, hours: 8 })), { day: "SAB", hours: 4 }],
      weeklyCompensatoryDay: { day: compDay, minutes: 240, startTime: "14:00", endTime: "18:00" },
    };
  }
  // Part time, mornings
  return {
    workStartTime: "08:30", workEndTime: "12:30", lunchStartTime: "", lunchEndTime: "",
    workSchedule: weekdays.map(day => ({ day, hours: 4 })),
  };
}

async function upsertAuthUser(email, displayName) {
  try {
    const existing = await auth.getUserByEmail(email);
    await auth.updateUser(existing.uid, { password: DEMO_PASSWORD, displayName });
    return existing.uid;
  } catch (e) {
    if (e.code !== "auth/user-not-found") throw e;
    const user = await auth.createUser({ email, password: DEMO_PASSWORD, displayName, emailVerified: true });
    return user.uid;
  }
}

// ---------------------------------------------------------------------------
// Departments (managed by HR in the app; same ids as the in-app first-run migration)
// ---------------------------------------------------------------------------
async function writeDepartments() {
  const batch = db.batch();
  const now = Timestamp.now();
  for (const name of DEPARTMENTS) {
    batch.set(db.collection("departments").doc(departmentId(name)), { name, isSystem: false, createdAt: now, updatedAt: now });
  }
  // Protected fallback: cannot be renamed or deleted (enforced by firestore.rules).
  batch.set(db.collection("departments").doc("nessuno"), { name: "Nessuno", isSystem: true, createdAt: now, updatedAt: now });
  await batch.commit();
  console.log(`  departments: ${DEPARTMENTS.length + 1}`);
}

/** Mirrors slugifyDepartmentName() in src/lib/departments.ts ("Back Office" -> "back-office"). */
function departmentId(name) {
  return name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// ---------------------------------------------------------------------------
// Holidays
// ---------------------------------------------------------------------------
function buildHolidays(years) {
  const out = {};
  for (const year of new Set(years)) {
    const easterMonday = addDays(easterSunday(year), 1);
    const fixed = [
      ["01-01", "Capodanno"], ["01-06", "Epifania"], ["04-25", "Festa della Liberazione"],
      ["05-01", "Festa dei Lavoratori"], ["06-02", "Festa della Repubblica"], ["08-15", "Ferragosto"],
      ["11-01", "Ognissanti"], ["12-08", "Immacolata Concezione"], ["12-25", "Natale"], ["12-26", "Santo Stefano"],
    ];
    const dates = fixed.map(([md, name]) => holiday(`${year}-${md}`, name));
    dates.push(holiday(format(easterMonday, "yyyy-MM-dd"), "Lunedì dell'Angelo"));
    dates.push(holiday(`${year}-10-04`, "Santo Patrono"));
    // Department-specific, partial-day closure to showcase that feature.
    dates.push(holiday(`${year}-12-30`, "Inventario di fine anno", { departments: ["Logistica", "Back Office"], isPartial: true, startTime: "14:00", endTime: "18:00" }));
    dates.push(holiday(`${year}-12-24`, "Vigilia di Natale", { isPartial: true, startTime: "13:00", endTime: "18:00" }));
    out[year] = dates.sort((a, b) => a.date.localeCompare(b.date));
  }
  return out;
}

function holiday(date, name, extra = {}) {
  return { id: `seed-${date}-${slug(name)}`, date, name, departments: [], isPartial: false, startTime: null, endTime: null, ...extra };
}

async function writeHolidays(byYear) {
  for (const [year, dates] of Object.entries(byYear)) {
    await db.collection("holidays").doc(String(year)).set({ dates });
  }
  console.log(`  holidays: ${Object.keys(byYear).join(", ")}`);
}

// Anonymous Gregorian algorithm
function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

// ---------------------------------------------------------------------------
// Time-off requests
// ---------------------------------------------------------------------------
async function createTimeOffRequests(users, holidaysByYear) {
  const fullHolidayDates = new Set(
    Object.values(holidaysByYear).flat().filter(h => !h.isPartial && h.departments.length === 0).map(h => h.date)
  );
  const all = [];
  let batch = db.batch();
  let pending = 0;

  for (const user of users) {
    if (user.excludeFromPlanning) continue;
    const workDays = new Set(user.workSchedule.map(d => d.day));
    const taken = []; // [start, end] to avoid overlaps per user
    const target = user.key === "user" ? 9 : faker.number.int({ min: 3, max: 8 });

    for (let attempt = 0; attempt < target * 6 && taken.length < target; attempt++) {
      const partial = faker.number.float() < 0.25;
      const type = weighted(partial ? PARTIAL_DAY_TYPES : FULL_DAY_TYPES);
      const length = partial ? 1 : lengthFor(type);
      // Unplanned absences (sickness, bereavement) can only be in the past.
      const unplanned = UNPLANNED_TYPES.has(type);
      const start = faker.date.between({ from: windowStart, to: unplanned ? subDays(today, length) : windowEnd });
      const end = addDays(start, length - 1);

      const days = eachDayOfInterval({ start, end }).filter(d =>
        workDays.has(DAY_IDS[d.getDay()]) && !fullHolidayDates.has(format(d, "yyyy-MM-dd"))
      );
      if (days.length === 0) continue;
      const startDate = format(days[0], "yyyy-MM-dd");
      const endDate = format(days[days.length - 1], "yyyy-MM-dd");
      if (taken.some(([s, e]) => startDate <= e && endDate >= s)) continue;
      taken.push([startDate, endDate]);

      let startTime = null, endTime = null;
      if (partial) {
        const morning = user.workStartTime === "08:30" || faker.datatype.boolean();
        [startTime, endTime] = morning
          ? [user.workStartTime || "09:00", faker.helpers.arrayElement(["10:00", "11:00"])]
          : [faker.helpers.arrayElement(["16:00", "17:00"]), user.workEndTime || "18:00"];
      }

      const isPast = days[0] < today;
      const status = isPast
        ? (faker.number.float() < 0.92 ? STATUS.APPROVED : STATUS.REJECTED)
        : weighted([[STATUS.APPROVED, 55], [STATUS.PENDING, 35], [STATUS.REJECTED, 10]]);

      const ref = db.collection("timeOffRequests").doc();
      const data = {
        userId: user.uid,
        userName: `${user.firstName} ${user.lastName}`,
        firstName: user.firstName,
        lastName: user.lastName,
        department: user.department,
        startDate,
        endDate,
        days: partial ? 0 : days.length,
        type,
        notes: noteFor(type),
        status,
        // Submitted before the absence (or on the day for sickness), never in the future.
        createdAt: Timestamp.fromDate(new Date(Math.min(
          subDays(days[0], unplanned ? 0 : faker.number.int({ min: 2, max: 30 })).getTime(),
          subDays(today, faker.number.int({ min: 0, max: 3 })).getTime(),
        ))),
        startTime,
        endTime,
      };
      batch.set(ref, data);
      all.push({ id: ref.id, ...data });
      if (++pending === 400) { await batch.commit(); batch = db.batch(); pending = 0; }
    }
  }
  if (pending) await batch.commit();
  console.log(`  timeOffRequests: ${all.length}`);
  return all;
}

function lengthFor(type) {
  switch (type) {
    case "Ferie": return faker.helpers.weightedArrayElement([{ value: 1, weight: 2 }, { value: 3, weight: 3 }, { value: 5, weight: 3 }, { value: 12, weight: 2 }]);
    case "Malattia": return faker.number.int({ min: 1, max: 4 });
    case "Lutto": return 3;
    default: return faker.number.int({ min: 1, max: 2 });
  }
}

function noteFor(type) {
  const notes = {
    "Ferie": ["", "", "Vacanza in famiglia", "Viaggio programmato", "Ponte"],
    "Malattia": ["", "Certificato medico inviato"],
    "ROL": ["", "Visita medica", "Commissioni personali", "Appuntamento in banca"],
    "Permesso per Formazione": ["Corso di aggiornamento", "Workshop esterno"],
    "Permesso di studio": ["Esame universitario"],
  };
  return faker.helpers.arrayElement(notes[type] ?? [""]);
}

// ---------------------------------------------------------------------------
// Compensatory-day move requests (users/{uid}/compensatoryMoveRequests/{weekId})
// ---------------------------------------------------------------------------
async function createCompensatoryMoves(users) {
  let count = 0;
  for (const user of users) {
    const comp = user.weeklyCompensatoryDay;
    if (!comp) continue;
    const n = user.key === "user" ? 0 : faker.number.int({ min: 1, max: 3 });
    for (let i = 0; i < n; i++) {
      const weekDate = startOfWeek(faker.date.between({ from: subMonths(today, 2), to: addMonths(today, 1) }), { weekStartsOn: 1 });
      // Same weekId format the app uses (src/app/timesheets/page.tsx)
      const weekId = `${weekDate.getFullYear()}-W${getWeek(weekDate, { weekStartsOn: 1 })}`;
      const requestedDay = faker.helpers.arrayElement(["LUN", "MAR", "MER", "GIO", "VEN"].filter(d => d !== comp.day));
      const status = weekDate < today ? weighted([["approved", 85], ["rejected", 15]]) : weighted([["pending", 60], ["approved", 40]]);
      await db.collection("users").doc(user.uid).collection("compensatoryMoveRequests").doc(weekId).set({
        id: weekId,
        status,
        requestedDay,
        originalDay: comp.day,
        minutes: comp.minutes,
        userId: user.uid,
        userName: `${user.firstName} ${user.lastName}`,
        requestedAt: Timestamp.fromDate(subDays(weekDate, faker.number.int({ min: 1, max: 6 }))),
      });
      count++;
    }
  }
  console.log(`  compensatoryMoveRequests: ${count}`);
  return count;
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
async function createNotifications(users, requests) {
  const byKey = Object.fromEntries(users.filter(u => u.key).map(u => [u.key, u]));
  const batch = db.batch();
  let count = 0;
  const add = (userId, type, title, message, extra = {}) => {
    batch.set(db.collection("notifications").doc(), {
      userId, type, title, message, read: faker.datatype.boolean({ probability: 0.4 }),
      createdAt: faker.date.recent({ days: 14 }), ...extra,
    });
    count++;
  };

  // Decisions on the demo user's own requests
  for (const r of requests.filter(r => r.userId === byKey.user.uid && r.status !== STATUS.PENDING).slice(-4)) {
    const approved = r.status === STATUS.APPROVED;
    add(r.userId, approved ? "timeoff-approved" : "timeoff-rejected",
      approved ? "Richiesta approvata" : "Richiesta rifiutata",
      `La tua richiesta di ${r.type} dal ${fmt(r.startDate)} è stata ${approved ? "approvata" : "rifiutata"}.`,
      { relatedId: r.id, actionUrl: "/time-off" });
  }

  // Pending requests waiting for HR / the department admin
  const pendingReqs = requests.filter(r => r.status === STATUS.PENDING);
  for (const r of pendingReqs.slice(0, 8)) {
    add(byKey.hr.uid, "timeoff-request", "Nuova richiesta di permesso",
      `${r.userName} ha richiesto ${r.type} dal ${fmt(r.startDate)}.`, { relatedId: r.id, actionUrl: "/time-off" });
  }
  for (const r of pendingReqs.filter(r => byKey.admin.managedDepartments.includes(r.department)).slice(0, 6)) {
    add(byKey.admin.uid, "timeoff-request", "Nuova richiesta di permesso",
      `${r.userName} (${r.department}) ha richiesto ${r.type} dal ${fmt(r.startDate)}.`, { relatedId: r.id, actionUrl: "/time-off" });
  }

  // Company-wide announcement
  for (const u of users.filter(u => u.key)) {
    add(u.uid, "announcement", "Piano ferie estive", "Ricordiamo di inserire le richieste di ferie estive entro la fine del mese.");
  }

  await batch.commit();
  console.log(`  notifications: ${count}`);
  return count;
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------
async function resetDemoData() {
  console.log("  resetting demo data...");
  for (const name of ["timeOffRequests", "archive_timeOffRequests", "notifications", "archive_notifications", "holidays", "departments", "users"]) {
    await db.recursiveDelete(db.collection(name)); // also removes users/*/compensatoryMoveRequests
  }
  let pageToken;
  const toDelete = [];
  do {
    const page = await auth.listUsers(1000, pageToken);
    toDelete.push(...page.users.filter(u => u.email?.endsWith(`@${DEMO_DOMAIN}`)).map(u => u.uid));
    pageToken = page.pageToken;
  } while (pageToken);
  if (toDelete.length) await auth.deleteUsers(toDelete);
  console.log(`  removed ${toDelete.length} demo auth users`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function weighted(pairs) {
  return faker.helpers.weightedArrayElement(pairs.map(([value, weight]) => ({ value, weight })));
}
function slug(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}
function fmt(isoDate) {
  return format(parseISO(isoDate), "dd/MM/yyyy");
}
function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
/** In-memory stand-in for the Admin SDK, used by --dry-run. */
function createDryRunBackend(store) {
  let nextId = 0;
  const docRef = (path, id = `doc${++nextId}`) => ({
    id,
    collection: (sub) => collectionRef(`${path}/${id}/${sub}`),
    set: async (data) => { (store[path] ??= {})[id] = data; },
  });
  const collectionRef = (path) => ({ doc: (id) => docRef(path, id) });
  const db = {
    collection: collectionRef,
    batch: () => {
      const ops = [];
      return { set: (ref, data) => ops.push([ref, data]), commit: async () => { for (const [ref, data] of ops) await ref.set(data); } };
    },
    recursiveDelete: async () => {},
  };
  const auth = {
    getUserByEmail: async () => { throw Object.assign(new Error("not found"), { code: "auth/user-not-found" }); },
    createUser: async () => ({ uid: `uid${++nextId}` }),
    updateUser: async () => {},
    setCustomUserClaims: async () => {},
    listUsers: async () => ({ users: [] }),
    deleteUsers: async () => {},
  };
  return { auth, db };
}

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

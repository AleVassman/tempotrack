// src/lib/departments.ts
//
// Data layer for the HR-managed `departments` collection.
//
// A department name is denormalised onto other documents, so renaming or
// deleting one has to update them too:
//   - users/{uid}.department            (the employee's department)
//   - users/{uid}.managedDepartments[]  (departments an admin manages)
//   - holidays/{year}.dates[].departments[]  (department-specific closures)
// Time-off requests keep the department they were filed under (historical record).

import {
  arrayRemove,
  collection,
  doc,
  getDocs,
  getDocsFromServer,
  query,
  serverTimestamp,
  Timestamp,
  where,
  writeBatch,
  type DocumentData,
  type DocumentReference,
  type QueryDocumentSnapshot,
  type WriteBatch,
} from "firebase/firestore";
import { db } from "./firebase";
import { DEPARTMENTS as DEFAULT_DEPARTMENTS } from "./constants";

export const DEPARTMENTS_COLLECTION = "departments";

/** The protected fallback department: it can never be renamed or deleted. */
export const NONE_DEPARTMENT = "Nessuno";
export const NONE_DEPARTMENT_ID = "nessuno";

/** Names that would be confused with "no department" and so can't be used. */
const RESERVED_NAMES = ["nessuno", "non assegnato", "nessun dipartimento"];
const MAX_NAME_LENGTH = 50;

/** Firestore allows 500 writes per batch; leave headroom. */
const BATCH_LIMIT = 450;

export interface Department {
  id: string;
  name: string;
  isSystem: boolean;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

interface HolidayEntry {
  id?: string;
  date: string;
  name: string;
  departments?: string[];
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collapses repeated whitespace and trims. */
export function normalizeDepartmentName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

const nameKey = (name: string) => normalizeDepartmentName(name).toLocaleLowerCase("it");

/** Stable, URL-safe id used for the default departments ("Back Office" -> "back-office"). */
export function slugifyDepartmentName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Alphabetical (Italian collation), with the protected department last. */
export function sortDepartments(list: Department[]): Department[] {
  return [...list].sort((a, b) => {
    if (a.isSystem !== b.isSystem) return a.isSystem ? 1 : -1;
    return a.name.localeCompare(b.name, "it", { sensitivity: "base" });
  });
}

export function departmentFromDoc(snap: QueryDocumentSnapshot<DocumentData>): Department {
  const data = snap.data();
  return {
    id: snap.id,
    name: String(data.name ?? ""),
    isSystem: data.isSystem === true,
    createdAt: (data.createdAt as Timestamp | undefined) ?? null,
    updatedAt: (data.updatedAt as Timestamp | undefined) ?? null,
  };
}

/** The static list, shaped like Firestore departments (used while loading). */
export const FALLBACK_DEPARTMENTS: Department[] = sortDepartments(
  DEFAULT_DEPARTMENTS.map((name) => ({
    id: name === NONE_DEPARTMENT ? NONE_DEPARTMENT_ID : slugifyDepartmentName(name),
    name,
    isSystem: name === NONE_DEPARTMENT,
  })),
);

/**
 * Returns an Italian error message, or null if `raw` is a valid new name.
 * `excludeId` skips the department being renamed (so "vendite" -> "Vendite" works).
 */
export function validateDepartmentName(raw: string, existing: Department[], excludeId?: string): string | null {
  const name = normalizeDepartmentName(raw);
  if (!name) return "Inserisci il nome del dipartimento.";
  if (name.length > MAX_NAME_LENGTH) return `Il nome può contenere al massimo ${MAX_NAME_LENGTH} caratteri.`;
  if (RESERVED_NAMES.includes(nameKey(name))) return `"${name}" è un nome riservato dal sistema.`;
  const duplicate = existing.find((d) => d.id !== excludeId && nameKey(d.name) === nameKey(name));
  if (duplicate) return `Esiste già un dipartimento chiamato "${duplicate.name}".`;
  return null;
}

type BatchOp = (batch: WriteBatch) => void;

/**
 * Commits the operations atomically in a single batch. Above the batch limit
 * (hundreds of affected employees) they are split, and atomicity holds per chunk.
 */
async function commitOps(ops: BatchOp[]): Promise<void> {
  for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    ops.slice(i, i + BATCH_LIMIT).forEach((op) => op(batch));
    await batch.commit();
  }
}

// ---------------------------------------------------------------------------
// First-run migration
// ---------------------------------------------------------------------------

/**
 * Seeds the collection with the original static departments, but only after
 * confirming with the server that it is really empty: an empty snapshot from
 * the offline cache must never overwrite departments HR has renamed.
 * Uses deterministic ids, so two HR sessions racing here write identical data.
 * Returns true if it seeded.
 */
export async function seedDefaultDepartmentsIfEmpty(): Promise<boolean> {
  const existing = await getDocsFromServer(collection(db, DEPARTMENTS_COLLECTION));
  if (!existing.empty) return false;

  const batch = writeBatch(db);
  for (const dept of FALLBACK_DEPARTMENTS) {
    batch.set(doc(db, DEPARTMENTS_COLLECTION, dept.id), {
      name: dept.name,
      isSystem: dept.isSystem,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
  await batch.commit();
  return true;
}

// ---------------------------------------------------------------------------
// Impact analysis (what a rename/delete will touch)
// ---------------------------------------------------------------------------

export interface DepartmentImpact {
  /** Employees whose department is this one (excluding deleted accounts). */
  activeUserCount: number;
  /** Admins who list it in managedDepartments. */
  managerCount: number;
  /** Department-specific holidays that mention it. */
  holidayCount: number;
  /** Holidays that apply ONLY to this department (removed on delete). */
  exclusiveHolidayCount: number;
  // Raw references used to build the batch.
  userRefs: DocumentReference[];
  managers: { ref: DocumentReference; managedDepartments: string[] }[];
  holidayDocs: { ref: DocumentReference; dates: HolidayEntry[] }[];
}

export async function getDepartmentImpact(name: string): Promise<DepartmentImpact> {
  const [usersSnap, managersSnap, holidaysSnap] = await Promise.all([
    getDocs(query(collection(db, "users"), where("department", "==", name))),
    getDocs(query(collection(db, "users"), where("managedDepartments", "array-contains", name))),
    getDocs(collection(db, "holidays")),
  ]);

  let holidayCount = 0;
  let exclusiveHolidayCount = 0;
  const holidayDocs: DepartmentImpact["holidayDocs"] = [];
  holidaysSnap.forEach((snap) => {
    const dates = (snap.data().dates as HolidayEntry[] | undefined) ?? [];
    const mentions = dates.filter((h) => h.departments?.includes(name));
    if (mentions.length === 0) return;
    holidayCount += mentions.length;
    exclusiveHolidayCount += mentions.filter((h) => h.departments!.length === 1).length;
    holidayDocs.push({ ref: snap.ref, dates });
  });

  return {
    activeUserCount: usersSnap.docs.filter((d) => d.data().status !== "deleted").length,
    managerCount: managersSnap.size,
    holidayCount,
    exclusiveHolidayCount,
    // Deleted accounts are updated too, so no document points at a missing department.
    userRefs: usersSnap.docs.map((d) => d.ref),
    managers: managersSnap.docs.map((d) => ({
      ref: d.ref,
      managedDepartments: (d.data().managedDepartments as string[] | undefined) ?? [],
    })),
    holidayDocs,
  };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function addDepartment(rawName: string, existing: Department[]): Promise<void> {
  const error = validateDepartmentName(rawName, existing);
  if (error) throw new Error(error);
  const ref = doc(collection(db, DEPARTMENTS_COLLECTION));
  await commitOps([
    (b) =>
      b.set(ref, {
        name: normalizeDepartmentName(rawName),
        isSystem: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
  ]);
}

/**
 * Renames a department and, in the same batch, every employee, admin
 * (managedDepartments) and holiday that references the old name.
 * Returns the number of employees moved to the new name.
 */
export async function renameDepartment(dept: Department, rawNewName: string, existing: Department[]): Promise<number> {
  if (dept.isSystem) throw new Error(`Il dipartimento "${dept.name}" è protetto e non può essere rinominato.`);
  const error = validateDepartmentName(rawNewName, existing, dept.id);
  if (error) throw new Error(error);

  const oldName = dept.name;
  const newName = normalizeDepartmentName(rawNewName);
  if (newName === oldName) return 0;

  const impact = await getDepartmentImpact(oldName);
  const replace = (list: string[]) => Array.from(new Set(list.map((d) => (d === oldName ? newName : d))));

  const ops: BatchOp[] = [
    (b) => b.update(doc(db, DEPARTMENTS_COLLECTION, dept.id), { name: newName, updatedAt: serverTimestamp() }),
    ...impact.userRefs.map((ref): BatchOp => (b) => b.update(ref, { department: newName })),
    ...impact.managers.map(({ ref, managedDepartments }): BatchOp => (b) =>
      b.update(ref, { managedDepartments: replace(managedDepartments) }),
    ),
    ...impact.holidayDocs.map(({ ref, dates }): BatchOp => (b) =>
      b.update(ref, {
        dates: dates.map((h) => (h.departments?.includes(oldName) ? { ...h, departments: replace(h.departments) } : h)),
      }),
    ),
  ];
  await commitOps(ops);
  return impact.activeUserCount;
}

/**
 * Deletes a department and, in the same batch: moves its employees to
 * "Nessuno", removes it from admins' managedDepartments, removes it from
 * department-specific holidays, and drops holidays that applied ONLY to it
 * (an empty list means "every department", which would wrongly make them
 * company-wide). Pass the impact the user confirmed.
 */
export async function deleteDepartment(dept: Department, impact: DepartmentImpact): Promise<void> {
  if (dept.isSystem) throw new Error(`Il dipartimento "${dept.name}" è protetto e non può essere eliminato.`);
  const name = dept.name;

  const ops: BatchOp[] = [
    (b) => b.delete(doc(db, DEPARTMENTS_COLLECTION, dept.id)),
    ...impact.userRefs.map((ref): BatchOp => (b) => b.update(ref, { department: NONE_DEPARTMENT })),
    ...impact.managers.map(({ ref }): BatchOp => (b) => b.update(ref, { managedDepartments: arrayRemove(name) })),
    ...impact.holidayDocs.map(({ ref, dates }): BatchOp => (b) =>
      b.update(ref, {
        dates: dates
          .filter((h) => !(h.departments?.length === 1 && h.departments[0] === name))
          .map((h) => (h.departments?.includes(name) ? { ...h, departments: h.departments.filter((d) => d !== name) } : h)),
      }),
    ),
  ];
  await commitOps(ops);
}

"use client";

// One real-time listener on the `departments` collection, shared by the whole
// app through context: when HR adds, renames or deletes a department, every
// dropdown, form and grouping updates without a reload.

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  DEPARTMENTS_COLLECTION,
  FALLBACK_DEPARTMENTS,
  departmentFromDoc,
  seedDefaultDepartmentsIfEmpty,
  sortDepartments,
  type Department,
} from "@/lib/departments";

interface DepartmentsState {
  departments: Department[];
  loading: boolean;
  /** "fallback" = the static default list (still loading, empty collection or error). */
  source: "live" | "fallback";
}

export interface DepartmentsContextValue extends DepartmentsState {
  /** Every department name, protected one last (for "department" pickers). */
  names: string[];
  /** Names an employee can be grouped under or an admin can manage (excludes "Nessuno"). */
  assignableNames: string[];
}

function withDerived(state: DepartmentsState): DepartmentsContextValue {
  return {
    ...state,
    names: state.departments.map((d) => d.name),
    assignableNames: state.departments.filter((d) => !d.isSystem).map((d) => d.name),
  };
}

const initialState: DepartmentsState = { departments: FALLBACK_DEPARTMENTS, loading: true, source: "fallback" };
const DepartmentsContext = createContext<DepartmentsContextValue>(withDerived(initialState));

interface DepartmentsProviderProps {
  /** Listen only for signed-in users (Firestore rules require auth). */
  enabled: boolean;
  /** HR may run the first-run migration when the collection is empty. */
  canSeed: boolean;
  children: React.ReactNode;
}

export function DepartmentsProvider({ enabled, canSeed, children }: DepartmentsProviderProps) {
  const [state, setState] = useState<DepartmentsState>(initialState);
  const seedAttempted = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const unsubscribe = onSnapshot(
      collection(db, DEPARTMENTS_COLLECTION),
      (snap) => {
        if (!snap.empty) {
          setState({ departments: sortDepartments(snap.docs.map(departmentFromDoc)), loading: false, source: "live" });
          return;
        }
        // Empty: keep showing the defaults. An empty *cached* snapshot proves nothing,
        // so wait for the server before migrating (the seed re-checks the server too).
        setState({ departments: FALLBACK_DEPARTMENTS, loading: snap.metadata.fromCache, source: "fallback" });
        if (canSeed && !snap.metadata.fromCache && !seedAttempted.current) {
          seedAttempted.current = true;
          seedDefaultDepartmentsIfEmpty().catch((error) => {
            console.error("Department migration failed:", error);
            seedAttempted.current = false;
          });
        }
      },
      (error) => {
        console.error("Error listening to departments:", error);
        setState({ departments: FALLBACK_DEPARTMENTS, loading: false, source: "fallback" });
      },
    );
    return () => unsubscribe();
  }, [enabled, canSeed]);

  const value = useMemo(() => withDerived(state), [state]);
  return <DepartmentsContext.Provider value={value}>{children}</DepartmentsContext.Provider>;
}

export function useDepartments(): DepartmentsContextValue {
  return useContext(DepartmentsContext);
}

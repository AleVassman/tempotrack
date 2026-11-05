"use client";

// "Gestisci Dipartimenti": HR adds, renames and deletes departments.
// Renames and deletes cascade to employees, admins and holidays
// (see src/lib/departments.ts).

import { useState } from "react";
import { Check, Loader2, Lock, Pencil, Plus, Trash2, Users as UsersIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/components/ui/use-toast";
import { useDepartments } from "@/hooks/use-departments";
import {
  NONE_DEPARTMENT,
  addDepartment,
  deleteDepartment,
  getDepartmentImpact,
  renameDepartment,
  validateDepartmentName,
  type Department,
  type DepartmentImpact,
} from "@/lib/departments";

interface ManageDepartmentsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Employees per department name (from the live users list). */
  userCounts: Record<string, number>;
}

const usersLabel = (n: number) => (n === 0 ? "Nessun utente" : n === 1 ? "1 utente" : `${n} utenti`);

export function ManageDepartmentsDialog({ open, onOpenChange, userCounts }: ManageDepartmentsDialogProps) {
  const { departments, source } = useDepartments();
  const { toast } = useToast();

  // Add
  const [newName, setNewName] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  // Inline rename
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  // Delete
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ dept: Department; impact: DepartmentImpact } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const busy = isAdding || !!savingId || !!checkingId || isDeleting;
  // Until the live collection exists (first-run migration), writes would target missing docs.
  const readOnly = source !== "live";
  const editingDept = departments.find((d) => d.id === editingId) ?? null;

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const error = validateDepartmentName(newName, departments);
    if (error) {
      setAddError(error);
      return;
    }
    setIsAdding(true);
    try {
      await addDepartment(newName, departments);
      toast({ title: "Dipartimento aggiunto", description: `"${newName.trim()}" è ora disponibile in tutta l'app.` });
      setNewName("");
      setAddError(null);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Impossibile aggiungere il dipartimento.");
    } finally {
      setIsAdding(false);
    }
  };

  const startEdit = (dept: Department) => {
    setEditingId(dept.id);
    setEditValue(dept.name);
    setEditError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValue("");
    setEditError(null);
  };

  const saveEdit = async () => {
    if (!editingDept) return cancelEdit();
    if (editValue.trim() === editingDept.name) return cancelEdit();
    const error = validateDepartmentName(editValue, departments, editingDept.id);
    if (error) {
      setEditError(error);
      return;
    }
    setSavingId(editingDept.id);
    try {
      const moved = await renameDepartment(editingDept, editValue, departments);
      toast({
        title: "Dipartimento rinominato",
        description: `"${editingDept.name}" ora si chiama "${editValue.trim()}". ${moved > 0 ? `${usersLabel(moved)} aggiornati.` : ""}`.trim(),
      });
      cancelEdit();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Impossibile rinominare il dipartimento.");
    } finally {
      setSavingId(null);
    }
  };

  const runDelete = async (dept: Department, impact: DepartmentImpact) => {
    setIsDeleting(true);
    try {
      await deleteDepartment(dept, impact);
      toast({
        title: "Dipartimento eliminato",
        description:
          impact.activeUserCount > 0
            ? `${usersLabel(impact.activeUserCount)} spostati in "${NONE_DEPARTMENT}".`
            : `"${dept.name}" è stato rimosso.`,
      });
      setPendingDelete(null);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Errore",
        description: err instanceof Error ? err.message : "Impossibile eliminare il dipartimento.",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteClick = async (dept: Department) => {
    setCheckingId(dept.id);
    try {
      // Check the database, not the on-screen badge: it counts accounts the list hides too.
      const impact = await getDepartmentImpact(dept.name);
      if (impact.activeUserCount === 0 && impact.exclusiveHolidayCount === 0) {
        await runDelete(dept, impact); // nobody affected: delete straight away
      } else {
        setPendingDelete({ dept, impact });
      }
    } catch (err) {
      console.error(err);
      toast({ variant: "destructive", title: "Errore", description: "Impossibile verificare gli utenti del dipartimento." });
    } finally {
      setCheckingId(null);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => { if (!next) cancelEdit(); onOpenChange(next); }}>
        <DialogContent
          className="max-w-xl max-h-[90vh] flex flex-col gap-6"
          onEscapeKeyDown={(e) => {
            // Escape while renaming cancels the rename instead of closing the dialog.
            if (editingId) { e.preventDefault(); cancelEdit(); }
          }}
        >
          <DialogHeader>
            <DialogTitle>Gestisci Dipartimenti</DialogTitle>
            <DialogDescription>
              Le modifiche si applicano subito a dipendenti, responsabili e festività. Il dipartimento &quot;{NONE_DEPARTMENT}&quot; è protetto.
            </DialogDescription>
          </DialogHeader>

          {/* Top zone: add */}
          <form onSubmit={handleAdd} className="space-y-2">
            <Label htmlFor="new-department">Aggiungi Nuovo Dipartimento</Label>
            <div className="flex gap-2">
              <Input
                id="new-department"
                placeholder="Es. Ricerca e Sviluppo"
                value={newName}
                maxLength={60}
                disabled={readOnly || isAdding}
                aria-invalid={!!addError}
                aria-describedby={addError ? "new-department-error" : undefined}
                onChange={(e) => { setNewName(e.target.value); if (addError) setAddError(null); }}
              />
              <Button type="submit" disabled={readOnly || busy || !newName.trim()}>
                {isAdding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                Aggiungi
              </Button>
            </div>
            {addError && <p id="new-department-error" className="text-sm text-destructive">{addError}</p>}
            {readOnly && <p className="text-sm text-muted-foreground">Caricamento dei dipartimenti in corso...</p>}
          </form>

          {/* Bottom zone: existing departments */}
          <div className="flex min-h-0 flex-col gap-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Dipartimenti Esistenti</h3>
              <span className="text-xs text-muted-foreground">{departments.length} totali</span>
            </div>
            <ScrollArea className="max-h-[45vh] rounded-md border">
              <ul className="divide-y" data-testid="departments-list">
                {departments.map((dept) => {
                  const count = userCounts[dept.name] ?? 0;
                  const isEditing = editingId === dept.id;
                  return (
                    <li key={dept.id} className="flex items-center gap-3 px-3 py-2.5" data-department={dept.name}>
                      {isEditing ? (
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <Input
                              autoFocus
                              value={editValue}
                              maxLength={60}
                              disabled={savingId === dept.id}
                              aria-label={`Nuovo nome per ${dept.name}`}
                              aria-invalid={!!editError}
                              onChange={(e) => { setEditValue(e.target.value); if (editError) setEditError(null); }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") { e.preventDefault(); saveEdit(); }
                                // Also handled here: if a toast is open, Radix routes Escape to the toast layer, not the dialog.
                                if (e.key === "Escape") cancelEdit();
                              }}
                              className="h-8"
                            />
                            <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={saveEdit} disabled={savingId === dept.id} aria-label="Salva nome">
                              {savingId === dept.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 text-green-600" />}
                            </Button>
                            <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={cancelEdit} disabled={savingId === dept.id} aria-label="Annulla modifica">
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                          {editError && <p className="text-xs text-destructive">{editError}</p>}
                        </div>
                      ) : (
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          {dept.isSystem && <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />}
                          <span className="truncate text-sm font-medium">{dept.name}</span>
                          {dept.isSystem && <Badge variant="outline" className="shrink-0 text-[10px] font-normal">Protetto</Badge>}
                        </div>
                      )}

                      {!isEditing && (
                        <>
                          <Badge variant={count > 0 ? "secondary" : "outline"} className="shrink-0 gap-1 font-normal">
                            <UsersIcon className="h-3 w-3" aria-hidden />
                            {usersLabel(count)}
                          </Badge>
                          {dept.isSystem ? (
                            <span className="w-[72px] shrink-0" aria-hidden />
                          ) : (
                            <div className="flex shrink-0 gap-1">
                              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => startEdit(dept)} disabled={readOnly || busy} aria-label={`Rinomina ${dept.name}`}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => handleDeleteClick(dept)} disabled={readOnly || busy} aria-label={`Elimina ${dept.name}`}>
                                {checkingId === dept.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                              </Button>
                            </div>
                          )}
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edge case A: deleting a department that still has employees */}
      <AlertDialog open={!!pendingDelete} onOpenChange={(next) => { if (!next && !isDeleting) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminare &quot;{pendingDelete?.dept.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                {pendingDelete && pendingDelete.impact.activeUserCount > 0 && (
                  <p>
                    <span className="font-semibold text-foreground">Attenzione:</span>{" "}
                    {pendingDelete.impact.activeUserCount === 1
                      ? "c'è 1 utente assegnato"
                      : `ci sono ${pendingDelete.impact.activeUserCount} utenti assegnati`}{" "}
                    a &quot;{pendingDelete.dept.name}&quot;. Se elimini questo dipartimento, tutti gli utenti associati verranno
                    automaticamente spostati in &quot;{NONE_DEPARTMENT}&quot;.
                  </p>
                )}
                {pendingDelete && pendingDelete.impact.managerCount > 0 && (
                  <p>Verrà rimosso dai dipartimenti gestiti di {pendingDelete.impact.managerCount === 1 ? "1 responsabile" : `${pendingDelete.impact.managerCount} responsabili`}.</p>
                )}
                {pendingDelete && pendingDelete.impact.exclusiveHolidayCount > 0 && (
                  <p>
                    {pendingDelete.impact.exclusiveHolidayCount === 1 ? "1 festività riservata" : `${pendingDelete.impact.exclusiveHolidayCount} festività riservate`} a questo dipartimento{" "}
                    {pendingDelete.impact.exclusiveHolidayCount === 1 ? "verrà eliminata" : "verranno eliminate"}.
                  </p>
                )}
                <p>Vuoi procedere?</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Annulla</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault(); // keep the dialog open until the batch finishes
                if (pendingDelete) runDelete(pendingDelete.dept, pendingDelete.impact);
              }}
            >
              {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isDeleting ? "Eliminazione..." : "Sì, elimina"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

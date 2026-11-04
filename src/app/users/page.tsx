"use client";

import { useState, useEffect } from "react";
import { collection, getDocs, query, doc, updateDoc, setDoc, deleteField, onSnapshot, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { differenceInMinutes, parseISO } from "date-fns";
import { useAuth, UserProfile, WorkDay, WeeklyCompensatoryTimeOff } from "@/app/layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pencil, Users as UsersIcon, AlertTriangle, PlusCircle, Trash2, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DEPARTMENTS, DAYS_OF_WEEK, USER_ROLES, IS_DEMO, DEMO_USER_MANAGEMENT_MESSAGE } from "@/lib/constants";
import { AddUserForm } from "@/components/add-user-form";
import { getFunctions, httpsCallable } from "firebase/functions";

interface UserDocument extends UserProfile {
    id: string;
    email: string;
    compleanno?: string;
}

function UsersSkeleton() {
    return (
        <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
                <Card key={i}>
                    <CardHeader>
                        <Skeleton className="h-6 w-1/4" />
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Nome</TableHead>
                                    <TableHead>Email</TableHead>
                                    <TableHead>Ruolo</TableHead>
                                    <TableHead>Orario Lavoro</TableHead>
                                    <TableHead>Schema Orario</TableHead>
                                    <TableHead className="text-right">Azione</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {[...Array(3)].map((_, j) => (
                                    <TableRow key={j}>
                                        <TableCell><Skeleton className="h-4 w-[150px]" /></TableCell>
                                        <TableCell><Skeleton className="h-4 w-[200px]" /></TableCell>
                                        <TableCell><Skeleton className="h-4 w-[100px]" /></TableCell>
                                        <TableCell><Skeleton className="h-4 w-[120px]" /></TableCell>
                                        <TableCell><Skeleton className="h-4 w-[150px]" /></TableCell>
                                        <TableCell className="text-right"><Skeleton className="h-8 w-8 float-right rounded-md" /></TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}

export default function UsersPage() {
    const { user, userProfile, loading: authLoading } = useAuth();
    const { toast } = useToast();
    const [users, setUsers] = useState<UserDocument[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<UserDocument | null>(null);
    const [userToDelete, setUserToDelete] = useState<UserDocument | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [compensatoryDay, setCompensatoryDay] = useState<WorkDay['day'] | 'none'>('none');
    const [compStartTime, setCompStartTime] = useState<string>('');
    const [compEndTime, setCompEndTime] = useState<string>('');
    const [isAddUserDialogOpen, setIsAddUserDialogOpen] = useState(false);


    // const isHrUser = userProfile?.role === 'hr';
    const isHrUser = userProfile?.role === USER_ROLES.HR;

    const fetchUsers = async () => {
        if (!isHrUser) {
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);
        try {
            const usersQuery = query(collection(db, "users"), where("status", "!=", "deleted"));
            const querySnapshot = await getDocs(usersQuery);
            const usersData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as UserDocument));
            
            usersData.sort((a, b) => {
                const lastNameA = a.lastName || '';
                const lastNameB = b.lastName || '';
                const firstNameA = a.firstName || '';
                const firstNameB = b.firstName || '';

                if (lastNameA < lastNameB) return -1;
                if (lastNameA > lastNameB) return 1;
                if (firstNameA < firstNameB) return -1;
                if (firstNameA < firstNameB) return 1;
                return 0;
            });
            
            setUsers(usersData);
        } catch (error) {
            console.error("Error fetching users: ", error);
            setError("Impossibile caricare gli utenti. Controlla la tua connessione e riprova.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isHrUser) {
            fetchUsers();
        }
    }, [isHrUser]);

    const pageLoading = loading || authLoading;

    const handleEditClick = (userToEdit: UserDocument) => {
        const workSchedule = userToEdit.workSchedule && userToEdit.workSchedule.length > 0
            ? userToEdit.workSchedule
            : DAYS_OF_WEEK.map(day => ({ day: day.id, hours: 0 }));
    
        setEditingUser({
            ...userToEdit,
            workSchedule: workSchedule
        });

        if (userToEdit.weeklyCompensatoryDay) {
            setCompensatoryDay(userToEdit.weeklyCompensatoryDay.day);
            setCompStartTime(userToEdit.weeklyCompensatoryDay.startTime || '');
            setCompEndTime(userToEdit.weeklyCompensatoryDay.endTime || '');
        } else {
            setCompensatoryDay('none');
            setCompStartTime('');
            setCompEndTime('');
        }

        setIsEditDialogOpen(true);
    };

    const handleUpdateUser = async () => {
        if (!editingUser) return;
    
        try {
            const userDocRef = doc(db, "users", editingUser.id);
            const scheduleToSave = (editingUser.workSchedule || []).filter(day => day.hours > 0);
    
            const updateData: any = {
                firstName: editingUser.firstName || "",
                lastName: editingUser.lastName || "",
                compleanno: editingUser.compleanno || "",
                department: editingUser.department || "Nessuno",
                workStartTime: editingUser.workStartTime || "",
                workEndTime: editingUser.workEndTime || "",
                lunchStartTime: editingUser.lunchStartTime || "",
                lunchEndTime: editingUser.lunchEndTime || "",
                workSchedule: scheduleToSave,
                contactEmail: editingUser.contactEmail || "",
                cellphone: editingUser.cellphone || "",
            };

            if (compensatoryDay !== 'none' && compStartTime && compEndTime) {
                const start = parseISO(`1970-01-01T${compStartTime}:00`);
                const end = parseISO(`1970-01-01T${compEndTime}:00`);
                let diffMins = differenceInMinutes(end, start);
                if (diffMins < 0) diffMins = 0;

                updateData.weeklyCompensatoryDay = { 
                    day: compensatoryDay, 
                    minutes: diffMins,
                    startTime: compStartTime,
                    endTime: compEndTime
                };
            } else {
                updateData.weeklyCompensatoryDay = deleteField();
            }

            if (editingUser.role === USER_ROLES.ADMIN) {
                updateData.managedDepartments = editingUser.managedDepartments || [];
            } else {
                updateData.managedDepartments = deleteField();
            }


            await setDoc(userDocRef, updateData, { merge: true });
    
            toast({ title: "Utente Aggiornato", description: "I dati dell'utente sono stati aggiornati." });
            fetchUsers();
            setIsEditDialogOpen(false);
        } catch (error) {
            console.error("Error updating user: ", error);
            toast({ variant: "destructive", title: "Errore", description: "Impossibile aggiornare l'utente." });
        }
    };

    const handleDeleteUser = async () => {
        if (!userToDelete) return;

        if (IS_DEMO) {
            toast({ title: "Non disponibile nella demo", description: DEMO_USER_MANAGEMENT_MESSAGE });
            setUserToDelete(null);
            return;
        }

        setIsDeleting(true);
        try {
            const functions = getFunctions();
            const deleteUserCallable = httpsCallable(functions, 'deleteUser');

            // Call the cloud function with the userId
            await deleteUserCallable({ userId: userToDelete.id });

            toast({
                title: "Utente Eliminato",
                description: `L'utente ${userToDelete.firstName} ${userToDelete.lastName} è stato eliminato con successo.`,
            });

            fetchUsers(); // Refresh the user list
            setUserToDelete(null); // Close the dialog

        } catch (error: any) {
            console.error("Error deleting user:", error);
            toast({
                variant: "destructive",
                title: "Errore",
                description: error.message || "Impossibile eliminare l'utente.",
            });
        } finally {
            setIsDeleting(false);
        }
    };

    const handleWorkDayChange = (dayId: WorkDay['day'], hours: number) => {
        if (!editingUser) return;
    
        const existingSchedule = [...(editingUser.workSchedule || [])];
        const dayIndex = existingSchedule.findIndex(d => d.day === dayId);
    
        if (dayIndex > -1) {
            existingSchedule[dayIndex] = { ...existingSchedule[dayIndex], hours };
        } else {
            existingSchedule.push({ day: dayId, hours });
        }
    
        existingSchedule.sort((a, b) => {
            const dayAIndex = DAYS_OF_WEEK.findIndex(d => d.id === a.day);
            const dayBIndex = DAYS_OF_WEEK.findIndex(d => d.id === b.day);
            return dayAIndex - dayBIndex;
        });
    
        setEditingUser({ ...editingUser, workSchedule: existingSchedule });
    };

    const handleManagedDepartmentChange = (department: string, isChecked: boolean) => {
        if (!editingUser) return;

        const currentManaged = editingUser.managedDepartments || [];
        let newManaged: string[];

        if (isChecked) {
            newManaged = [...currentManaged, department];
        } else {
            newManaged = currentManaged.filter(d => d !== department);
        }
        
        setEditingUser({ ...editingUser, managedDepartments: newManaged });
    };

    const formatWorkSchedule = (u: UserDocument) => {
       if (!u.workSchedule || u.workSchedule.length === 0) {
           return 'N/A';
       }
       let totalHours = u.workSchedule.reduce((acc, day) => acc + (day.hours || 0), 0);
       if (u.weeklyCompensatoryDay?.minutes) {
           totalHours -= u.weeklyCompensatoryDay.minutes / 60;
       }
       const days = u.workSchedule.map(d => d.day).join(', ');
       return `${days} - ${totalHours} ore/sett.`;
    };

    // Loading fallback
    if (authLoading) {
        return (
            <div className="flex flex-col gap-8">
                <p className="text-center text-muted-foreground py-8">Caricamento...</p>
            </div>
        );
    }
    // Auth required fallback
    if (!user || !userProfile) {
        return (
            <div className="flex flex-col gap-8">
                <p className="text-center text-muted-foreground py-8">Devi essere autenticato per visualizzare questa pagina.</p>
            </div>
        );
    }
    // Access denied for non-HR users
    if (!isHrUser) {
        return (
            <div className="flex flex-col gap-8">
                <p className="text-center text-muted-foreground py-8">Accesso negato. Solo HR può visualizzare questa pagina.</p>
            </div>
        );
    }

    const groupedUsers = users.reduce((acc, user) => {
        const department = user.department || 'Non Assegnato';
        if (!acc[department]) {
            acc[department] = [];
        }
        acc[department].push(user);
        return acc;
    }, {} as Record<string, UserDocument[]>);

    const sortedDepartments = Object.keys(groupedUsers).sort((a, b) => {
        if (a === 'Non Assegnato') return 1;
        if (b === 'Non Assegnato') return -1;
        return a.localeCompare(b);
    });

    return (
        <div className="flex flex-col gap-8">
            <div>
                <h1 className="font-headline text-3xl font-semibold">Gestione Utenti</h1>
                <p className="text-muted-foreground">
                    Visualizza e gestisci gli utenti della tua organizzazione raggruppati per dipartimento.
                </p>
            </div>
            <div className="flex justify-end">
                <Dialog open={isAddUserDialogOpen} onOpenChange={setIsAddUserDialogOpen}>
                    <DialogTrigger asChild>
                        <Button>
                            <PlusCircle className="mr-2 h-4 w-4" />
                            Aggiungi Utente
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                        <DialogHeader>
                            <DialogTitle>Crea Nuovo Utente</DialogTitle>
                            <DialogDescription>
                                Verrà creato un nuovo account in Firebase Authentication e un profilo utente in Firestore.
                            </DialogDescription>
                        </DialogHeader>
                        <AddUserForm onSuccess={() => {
                            setIsAddUserDialogOpen(false);
                            fetchUsers(); // Refresh the user list after adding
                        }} />
                    </DialogContent>
                </Dialog>
            </div>

            {pageLoading ? (
                <UsersSkeleton />
            ) : error ? (
                <div className="flex flex-col items-center justify-center h-64 text-center">
                    <AlertTriangle className="h-12 w-12 text-destructive" />
                    <h3 className="mt-4 text-lg font-semibold">Errore di Caricamento</h3>
                    <p className="mt-2 text-sm text-muted-foreground">{error}</p>
                    <Button onClick={fetchUsers} className="mt-6">Riprova</Button>
                </div>
            ) : (
                <Accordion type="multiple" defaultValue={sortedDepartments} className="w-full space-y-4">
                    {sortedDepartments.map((department) => (
                        <AccordionItem value={department} key={department} className="border-none">
                            <Card>
                                <CardHeader className="p-4">
                                     <AccordionTrigger className="p-2 -m-2">
                                        <div className="flex items-center gap-4">
                                            <div className="flex-1">
                                                <CardTitle className="text-xl">{department}</CardTitle>
                                                <CardDescription className="flex items-center gap-2">
                                                   <UsersIcon className="h-4 w-4"/> {groupedUsers[department].length} Utenti
                                                </CardDescription>
                                            </div>
                                        </div>
                                    </AccordionTrigger>
                                </CardHeader>
                                <AccordionContent>
                                    <CardContent className="p-0">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>Nome</TableHead>
                                                    <TableHead>Email</TableHead>
                                                    <TableHead>Ruolo</TableHead>
                                                    <TableHead>Orario Lavoro</TableHead>
                                                    <TableHead>Schema Orario</TableHead>
                                                    <TableHead className="text-right">Azione</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {groupedUsers[department].map((u) => (
                                                    <TableRow key={u.id}>
                                                        <TableCell className="font-medium">{u.firstName} {u.lastName}</TableCell>
                                                        <TableCell>{u.email}</TableCell>
                                                        <TableCell>
                                                            <Badge variant={u.role === USER_ROLES.ADMIN || u.role === USER_ROLES.HR ? 'default' : 'secondary'}>{u.role}</Badge>
                                                        </TableCell>
                                                        <TableCell className="text-xs">
                                                            <div>Lavoro: {u.workStartTime || '--'} - {u.workEndTime || '--'}</div>
                                                            <div className="text-muted-foreground">Pausa: {u.lunchStartTime || '--'} - {u.lunchEndTime || '--'}</div>
                                                        </TableCell>
                                                        <TableCell className="text-xs font-mono">{formatWorkSchedule(u)}</TableCell>
                                                        <TableCell className="text-right">
                                                            <div className="flex gap-2 justify-end">
                                                                <Button variant="outline" size="sm" onClick={() => handleEditClick(u)}>
                                                                    <Pencil className="mr-2 h-4 w-4" />
                                                                    Modifica
                                                                </Button>
                                                                <AlertDialog>
                                                                    <AlertDialogTrigger asChild>
                                                                        <Button variant="destructive" size="icon" className="h-9 w-9" onClick={() => setUserToDelete(u)}>
                                                                            <Trash2 className="h-4 w-4" />
                                                                        </Button>
                                                                    </AlertDialogTrigger>
                                                                </AlertDialog>
                                                            </div>
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </CardContent>
                                </AccordionContent>
                            </Card>
                        </AccordionItem>
                    ))}
                </Accordion>
            )}

            {editingUser && (
                <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
                    <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
                        <DialogHeader>
                            <DialogTitle>Modifica Utente: {editingUser.firstName} {editingUser.lastName}</DialogTitle>
                        </DialogHeader>
                        <div className="grid gap-6 py-4 overflow-y-auto px-6">
                            <h3 className="text-lg font-medium border-b pb-2">Anagrafica e Dipartimento</h3>
                             <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="firstName">Nome</Label>
                                    <Input id="firstName" value={editingUser.firstName || ''} onChange={(e) => setEditingUser({ ...editingUser, firstName: e.target.value })}/>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="lastName">Cognome</Label>
                                    <Input id="lastName" value={editingUser.lastName || ''} onChange={(e) => setEditingUser({ ...editingUser, lastName: e.target.value })}/>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="contactEmail">Email di Contatto</Label>
                                    <Input id="contactEmail" type="email" value={editingUser.contactEmail || ''} onChange={(e) => setEditingUser({ ...editingUser, contactEmail: e.target.value })}/>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="cellphone">Cellulare</Label>
                                    <Input id="cellphone" value={editingUser.cellphone || ''} onChange={(e) => setEditingUser({ ...editingUser, cellphone: e.target.value })}/>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="compleanno">Data di Nascita</Label>
                                    <Input 
                                        id="compleanno" 
                                        type="date" 
                                        value={editingUser.compleanno || ''} 
                                        onChange={(e) => setEditingUser({ ...editingUser, compleanno: e.target.value })}
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="department">Dipartimento</Label>
                                <select
                                    id="department"
                                    value={editingUser.department || ''}
                                    onChange={(e) => setEditingUser({ ...editingUser, department: e.target.value })}
                                    className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    <option value="" disabled>Seleziona un dipartimento</option>
                                    {DEPARTMENTS.map(dep => (
                                        <option key={dep} value={dep}>{dep}</option>
                                    ))}
                                </select>
                            </div>
                            
                            {editingUser.role === USER_ROLES.ADMIN && (
                                <>
                                    <h3 className="text-lg font-medium border-b pb-2">Dipartimenti Gestiti</h3>
                                    <div className="grid grid-cols-2 gap-4">
                                        {DEPARTMENTS.filter(d => d !== "Nessuno").map(dep => (
                                            <div key={dep} className="flex items-center space-x-2">
                                                <Checkbox
                                                    id={`dep-${dep}`}
                                                    checked={editingUser.managedDepartments?.includes(dep)}
                                                    onCheckedChange={(checked) => handleManagedDepartmentChange(dep, !!checked)}
                                                />
                                                <label
                                                    htmlFor={`dep-${dep}`}
                                                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                                >
                                                    {dep}
                                                </label>
                                            </div>
                                        ))}
                                    </div>
                                </>
                            )}
                            
                             <h3 className="text-lg font-medium border-b pb-2">Orario di Lavoro Standard</h3>
                              <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="workStartTime">Inizio Lavoro</Label>
                                    <Input id="workStartTime" type="time" value={editingUser.workStartTime || ''} onChange={(e) => setEditingUser({ ...editingUser, workStartTime: e.target.value })}/>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="workEndTime">Fine Lavoro</Label>
                                    <Input id="workEndTime" type="time" value={editingUser.workEndTime || ''} onChange={(e) => setEditingUser({ ...editingUser, workEndTime: e.target.value })} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="lunchStartTime">Inizio Pausa</Label>
                                    <Input id="lunchStartTime" type="time" value={editingUser.lunchStartTime || ''} onChange={(e) => setEditingUser({ ...editingUser, lunchStartTime: e.target.value })} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="lunchEndTime">Fine Pausa</Label>
                                    <Input id="lunchEndTime" type="time" value={editingUser.lunchEndTime || ''} onChange={(e) => setEditingUser({ ...editingUser, lunchEndTime: e.target.value })} />
                                </div>
                            </div>
                            <h3 className="text-lg font-medium border-b pb-2">Schema Orario Settimanale</h3>
                            <div className="space-y-3">
                                <div className="grid grid-cols-3 gap-x-4 gap-y-2 items-center font-medium text-sm">
                                    <Label className="col-span-1">Giorno</Label>
                                    <Label className="col-span-1">Attivo</Label>
                                    <Label className="col-span-1">Ore</Label>
                                </div>
                                {DAYS_OF_WEEK.map(day => {
                                    const scheduleDay = (editingUser.workSchedule || []).find(d => d.day === day.id);
                                    const isChecked = !!scheduleDay && scheduleDay.hours > 0;
                                    const hours = scheduleDay?.hours || 0;

                                    return (
                                        <div key={day.id} className="grid grid-cols-3 gap-x-4 gap-y-2 items-center">
                                            <Label htmlFor={`workday-${day.id}`} className="font-normal">{day.label}</Label>
                                            <Checkbox
                                                id={`workday-${day.id}`}
                                                checked={isChecked}
                                                onCheckedChange={(checked) => {
                                                    const newHours = checked ? (hours > 0 ? hours : 8) : 0; // Default to 8 if activating, 0 if deactivating
                                                    handleWorkDayChange(day.id, newHours);
                                                }}
                                            />
                                            <Input 
                                                type="number" 
                                                step="0.5"
                                                min="0"
                                                value={hours}
                                                disabled={!isChecked}
                                                onChange={(e) => handleWorkDayChange(day.id, parseFloat(e.target.value) || 0)}
                                                className="disabled:opacity-50 disabled:bg-muted"
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                             <h3 className="text-lg font-medium border-b pb-2">Recupero Compensativo Settimanale</h3>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                     <Label htmlFor="compensatory-day">Giorno di Recupero</Label>
                                      <Select value={compensatoryDay} onValueChange={(value) => setCompensatoryDay(value as WorkDay['day'] | 'none')}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Nessun recupero" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="none">Nessun recupero</SelectItem>
                                            {DAYS_OF_WEEK.map(day => (
                                                <SelectItem key={day.id} value={day.id}>{day.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                <Label htmlFor="comp-start">Dalle</Label>
                                <Input 
                                    id="comp-start" 
                                    type="time" 
                                    value={compStartTime} 
                                    onChange={(e) => setCompStartTime(e.target.value)} 
                                    disabled={compensatoryDay === 'none'} 
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="comp-end">Alle</Label>
                                <Input 
                                    id="comp-end" 
                                    type="time" 
                                    value={compEndTime} 
                                    onChange={(e) => setCompEndTime(e.target.value)} 
                                    disabled={compensatoryDay === 'none'} 
                                />
                            </div>
                            </div>
                        </div>
                        <DialogFooter className="mt-auto pt-4 border-t">
                            <DialogClose asChild>
                                <Button type="button" variant="secondary">Annulla</Button>
                            </DialogClose>
                            <Button type="button" onClick={handleUpdateUser}>Salva Modifiche</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}
            <AlertDialog open={!!userToDelete} onOpenChange={(open) => !open && setUserToDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Sei assolutamente sicuro?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Questa azione è irreversibile. L'utente{' '}
                            <span className="font-bold text-destructive">
                                {userToDelete?.firstName} {userToDelete?.lastName}
                            </span>{' '}
                            verrà rimosso da Firebase Authentication. Il suo profilo verrà contrassegnato come "eliminato" per preservare i dati storici.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isDeleting}>Annulla</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDeleteUser} disabled={isDeleting}>
                            {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {isDeleting ? 'Eliminazione...' : 'Sì, elimina utente'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
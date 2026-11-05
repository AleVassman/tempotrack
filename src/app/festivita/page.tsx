// src/app/festivita/page.tsx

"use client";

import { useState, useEffect } from "react";
import { doc, onSnapshot, setDoc, updateDoc, arrayUnion, arrayRemove } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/app/layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch"; // <-- AGGIUNTO IMPORT SWITCH
import { AlertTriangle, Trash2, Loader2, Calendar as CalendarIcon, Clock } from "lucide-react";
import { USER_ROLES } from "@/lib/constants";
import { useDepartments } from "@/hooks/use-departments";
import { format, parseISO } from "date-fns";
import { it } from "date-fns/locale";

// --- MODIFICATA: Interfaccia per includere i campi orari ---
interface DepartmentHoliday {
    id: string; 
    date: string;
    name: string;
    departments: string[]; 
    isPartial?: boolean;
    startTime?: string | null;
    endTime?: string | null;
}

export default function FestivitaPage() {
    const { userProfile, loading: authLoading } = useAuth();
    const { toast } = useToast();

    // Stato UI
    const [loading, setLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());

    // Dati
    const [holidays, setHolidays] = useState<DepartmentHoliday[]>([]);

    // Stato Form
    const [newName, setNewName] = useState("");
    const [newDate, setNewDate] = useState("");
    const [selectedDepts, setSelectedDepts] = useState<string[]>([]);
    
    // --- NUOVI STATI PER FESTIVITÀ PARZIALE ---
    const [isPartialDay, setIsPartialDay] = useState(false);
    const [startTime, setStartTime] = useState("");
    const [endTime, setEndTime] = useState("");

    const isHr = userProfile?.role === USER_ROLES.HR;
    // Live department list (managed by HR in Gestione Utenti), without "Nessuno".
    const { assignableNames: AVAILABLE_DEPARTMENTS } = useDepartments();
    const allDepartmentsSelected = AVAILABLE_DEPARTMENTS.length > 0 && AVAILABLE_DEPARTMENTS.every(d => selectedDepts.includes(d));

    useEffect(() => {
        if (authLoading || !isHr) {
            setLoading(false);
            return;
        }

        setLoading(true);
        const docRef = doc(db, "holidays", selectedYear);
        
        const unsub = onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
                const fetchedHolidays = (docSnap.data().dates as DepartmentHoliday[] ||[]).sort((a, b) => a.date.localeCompare(b.date));
                setHolidays(fetchedHolidays);
            } else {
                setHolidays([]);
            }
            setLoading(false);
        });

        return () => unsub();
    }, [selectedYear, isHr, authLoading]);

    const handleAddHoliday = async (e: React.FormEvent) => {
        e.preventDefault();
        
        // --- MODIFICATA: Validazione con orari ---
        const validDepts = selectedDepts.filter(d => AVAILABLE_DEPARTMENTS.includes(d));
        if (!newName || !newDate || validDepts.length === 0) {
            toast({ variant: "destructive", title: "Errore", description: "Compila tutti i campi e seleziona almeno un dipartimento." });
            return;
        }

        if (isPartialDay && (!startTime || !endTime)) {
            toast({ variant: "destructive", title: "Errore", description: "Inserisci l'ora di inizio e di fine per la festività parziale." });
            return;
        }

        setIsSubmitting(true);
        try {
            const year = newDate.split('-')[0];
            const docRef = doc(db, "holidays", year);
            
            // --- MODIFICATA: Salvataggio campi orari ---
            const newHoliday: DepartmentHoliday = {
                id: Date.now().toString(),
                date: newDate,
                name: newName,
                departments: validDepts,
                isPartial: isPartialDay,
                startTime: isPartialDay ? startTime : null,
                endTime: isPartialDay ? endTime : null,
            };

            await setDoc(docRef, {
                dates: arrayUnion(newHoliday)
            }, { merge: true });

            toast({ title: "Successo", description: "Festività aggiunta correttamente." });
            
            setNewName("");
            setNewDate("");
            setIsPartialDay(false);
            setStartTime("");
            setEndTime("");
            
            if (year !== selectedYear) setSelectedYear(year);

        } catch (error) {
            console.error(error);
            toast({ variant: "destructive", title: "Errore", description: "Impossibile salvare la festività." });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDeleteHoliday = async (holidayToDelete: DepartmentHoliday) => {
        try {
            const year = holidayToDelete.date.split('-')[0];
            const docRef = doc(db, "holidays", year);
            await updateDoc(docRef, { dates: arrayRemove(holidayToDelete) });
            toast({ title: "Eliminata", description: "La festività è stata rimossa." });
        } catch (error) {
            console.error(error);
            toast({ variant: "destructive", title: "Errore", description: "Impossibile eliminare la festività." });
        }
    };

    const toggleAllDepartments = () => {
        if (allDepartmentsSelected) {
            setSelectedDepts([]);
        } else {
            setSelectedDepts(AVAILABLE_DEPARTMENTS);
        }
    };

    const toggleDepartment = (dept: string) => {
        setSelectedDepts(prev => prev.includes(dept) ? prev.filter(d => d !== dept) : [...prev, dept]);
    };

    if (!authLoading && !isHr) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-center">
                <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
                <h1 className="font-headline text-2xl font-semibold">Accesso Negato</h1>
                <p className="text-muted-foreground mt-2">Solo gli utenti HR possono gestire le festività.</p>
            </div>
        );
    }

    const yearOptions = Array.from({ length: 5 }, (_, i) => (new Date().getFullYear() + 2 - i).toString());

    return (
        <div className="flex flex-col gap-8">
            <div>
                <h1 className="font-headline text-3xl font-semibold">Gestione Festività</h1>
                <p className="text-muted-foreground">Configura i giorni festivi e a quali dipartimenti si applicano.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                
                {/* FORM COLONNA SINISTRA */}
                <Card className="lg:col-span-1 h-fit">
                    <CardHeader>
                        <CardTitle className="text-xl">Nuova Festività</CardTitle>
                        <CardDescription>Aggiungi un giorno non lavorativo.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleAddHoliday} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="name">Nome (es. Santo Patrono)</Label>
                                <Input id="name" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Inserisci nome..." />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="date">Data</Label>
                                <Input id="date" type="date" value={newDate} onChange={e => setNewDate(e.target.value)} />
                            </div>

                            {/* --- NUOVO: SEZIONE FESTIVITÀ PARZIALE --- */}
                            <div className="flex items-center justify-between rounded-lg border p-3">
                                <div className="space-y-0.5">
                                    <Label htmlFor="partial-day">Festività Oraria</Label>
                                    <p className="text-[10px] text-muted-foreground">Attiva se è di mezza giornata.</p>
                                </div>
                                <Switch id="partial-day" checked={isPartialDay} onCheckedChange={setIsPartialDay} />
                            </div>

                            {isPartialDay && (
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="flex flex-col gap-2">
                                        <Label htmlFor="start-time">Dalle</Label>
                                        <Input id="start-time" type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
                                    </div>
                                    <div className="flex flex-col gap-2">
                                        <Label htmlFor="end-time">Alle</Label>
                                        <Input id="end-time" type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
                                    </div>
                                </div>
                            )}
                            {/* ------------------------------------------ */}
                            
                            <div className="space-y-3 pt-2">
                                <div className="flex items-center justify-between">
                                    <Label>Dipartimenti Applicati</Label>
                                    <Button type="button" variant="ghost" size="sm" onClick={toggleAllDepartments} className="h-auto p-0 text-primary">
                                        {allDepartmentsSelected ? 'Deseleziona Tutti' : 'Seleziona Tutti'}
                                    </Button>
                                </div>
                                <div className="grid grid-cols-1 gap-2 border rounded-md p-3 max-h-48 overflow-y-auto bg-muted/20">
                                    {AVAILABLE_DEPARTMENTS.map(dept => (
                                        <div key={dept} className="flex items-center space-x-2">
                                            <Checkbox 
                                                id={`dept-${dept}`} 
                                                checked={selectedDepts.includes(dept)}
                                                onCheckedChange={() => toggleDepartment(dept)}
                                            />
                                            <label htmlFor={`dept-${dept}`} className="text-sm font-medium leading-none cursor-pointer">
                                                {dept}
                                            </label>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <Button type="submit" className="w-full mt-4" disabled={isSubmitting}>
                                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Aggiungi Festività
                            </Button>
                        </form>
                    </CardContent>
                </Card>

                {/* LISTA COLONNA DESTRA */}
                <Card className="lg:col-span-2 h-fit">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
                        <div>
                            <CardTitle className="text-xl">Festività Registrate</CardTitle>
                            <CardDescription>Elenco delle festività per l'anno selezionato.</CardDescription>
                        </div>
                        <Select value={selectedYear} onValueChange={setSelectedYear}>
                            <SelectTrigger className="w-[120px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {yearOptions.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </CardHeader>
                    <CardContent>
                        {loading ? (
                            <div className="space-y-4"><Skeleton className="h-10 w-full"/><Skeleton className="h-10 w-full"/></div>
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Data</TableHead>
                                        <TableHead>Dettagli Festività</TableHead>
                                        <TableHead>Dipartimenti</TableHead>
                                        <TableHead className="text-right">Azioni</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {holidays.length === 0 ? (
                                        <TableRow><TableCell colSpan={4} className="text-center h-24 text-muted-foreground">Nessuna festività configurata per il {selectedYear}.</TableCell></TableRow>
                                    ) : (
                                        holidays.map((holiday, index) => {
                                            const depts = holiday.departments ||[];
                                            const isAll = depts.length === 0 || AVAILABLE_DEPARTMENTS.every(d => depts.includes(d));

                                            return (
                                                <TableRow key={holiday.id || `legacy-${holiday.date}-${index}`}>
                                                    <TableCell className="font-medium whitespace-nowrap align-top pt-4">
                                                        <div className="flex items-center gap-2">
                                                            <CalendarIcon className="h-4 w-4 text-muted-foreground"/>
                                                            {format(parseISO(holiday.date), 'dd MMM yyyy', { locale: it })}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="align-top pt-4">
                                                        <div className="font-medium">{holiday.name}</div>
                                                        {/* --- NUOVO: MOSTRA L'ORARIO NELLA TABELLA --- */}
                                                        {holiday.isPartial && holiday.startTime && holiday.endTime ? (
                                                            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                                                                <Clock className="h-3 w-3" />
                                                                {holiday.startTime} - {holiday.endTime}
                                                            </div>
                                                        ) : (
                                                            <div className="text-xs text-muted-foreground mt-1">Giornata intera</div>
                                                        )}
                                                    </TableCell>
                                                    <TableCell className="align-top pt-4">
                                                        {isAll ? (
                                                            <Badge variant="default" className="bg-green-600">Tutti i Dipartimenti</Badge>
                                                        ) : (
                                                            <div className="flex flex-wrap gap-1">
                                                                {depts.map(d => (
                                                                    <Badge key={d} variant="secondary" className="text-[10px] leading-tight">{d}</Badge>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </TableCell>
                                                    <TableCell className="text-right align-top pt-4">
                                                        <Button variant="ghost" size="icon" className="text-destructive hover:bg-destructive/10" onClick={() => handleDeleteHoliday(holiday)}>
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })
                                    )}
                                </TableBody>
                            </Table>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
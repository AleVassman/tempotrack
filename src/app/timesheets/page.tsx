// src/app/timesheets/page.tsx

"use client";

import { useState, useEffect, useMemo } from "react";
import { collection, query, where, doc, onSnapshot, setDoc, serverTimestamp, deleteDoc, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth, UserProfile, WorkDay } from "@/app/layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Download, Loader2, Clock, CalendarOff, Briefcase, Pill, Eye, ArrowRightLeft, Trash2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { addMonths, subMonths, format, getDaysInMonth, startOfMonth, getDay, endOfMonth, parseISO, isWithinInterval, startOfDay, endOfDay, differenceInMinutes, parse, isWeekend, getWeek, addDays } from "date-fns";
import { it } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetDescription } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { isExcludedFromPlanning } from "@/lib/constants";

// --- INTERFACCE ---
interface UserDocument extends UserProfile { 
    id: string; 
    email: string; 
    status?: string;
}

interface HolidayData { 
    date: string;
    name: string; 
    departments?: string[]; 
    isPartial?: boolean; 
    startTime?: string | null; 
    endTime?: string | null; 
}

interface TimeOffRequest { 
    id: string; 
    userId: string; 
    startDate: string; 
    endDate: string; 
    type: string; 
    status: 'In Sospeso' | 'Approvato' | 'Rifiutato'; 
    startTime?: string | null; 
    endTime?: string | null; 
    days: number; 
}

interface CompensatoryMoveRequest { 
    id: string; 
    status: 'pending' | 'approved' | 'rejected'; 
    requestedDay: WorkDay['day']; 
    originalDay: WorkDay['day']; 
    minutes: number; 
    userId: string; 
    userName: string; 
    requestedAt: any; 
}

interface MoveRequestData { 
    weekId: string; 
    weekNumber: number; 
    year: number; 
    user: UserDocument; 
}

interface DayData { 
    type: 'work' | 'leave' | 'compensatory' | 'weekend' | 'holiday'; 
    value: number | string; 
    isCompensatoryMoved?: boolean; 
    moveRequestStatus?: 'pending' | 'rejected'; 
    holidayLabel?: string;
}

interface TimesheetRow { 
    userId: string; 
    userName: string; 
    dailyData: DayData[]; 
    totalMinutes: number; 
    totalFerieMinutes: number; 
    totalPermessiMinutes: number; 
    totalRolMinutes: number; 
    totalMalattiaMinutes: number; 
}

// --- COSTANTI E CONFIGURAZIONI ---

const dayMapping: { [key: number]: WorkDay['day'] } = { 0: 'DOM', 1: 'LUN', 2: 'MAR', 3: 'MER', 4: 'GIO', 5: 'VEN', 6: 'SAB' };

const leaveTypeCategories: { [key: string]: 'ferie' | 'permessi' | 'rol' | 'malattia' } = { 
    'Ferie': 'ferie', 'Assenza non Retribuita': 'ferie', 'Ex Festività': 'ferie', 'Paternità': 'ferie', 
    'Maternità': 'ferie', 'Parentale': 'ferie', 'Lutto': 'ferie', 'Legge 104': 'ferie', 
    'Licenza Matrimoniale': 'ferie', 'Permesso per Donazione del Sangue': 'permessi', 
    'Permesso per Formazione': 'permessi', 'Permesso non retribuito': 'permessi', 
    'Permesso di studio': 'permessi', 'ROL': 'rol', 'Infortunio': 'malattia', 'Malattia': 'malattia' 
};

// --- FUNZIONI HELPER ---

function formatMinutes(totalMinutes: number): string {
    if (totalMinutes <= 0) return "0h";
    const hours = Math.floor(totalMinutes / 60);
    const minutes = Math.round(totalMinutes % 60);
    if (minutes === 0) return `${hours}h`;
    return `${hours}h ${minutes}m`;
}

// Funzione per calcolare la sovrapposizione tra due intervalli orari
function calculateTimeOverlap(start1?: string, end1?: string, start2?: string, end2?: string): number {
    if (!start1 || !end1 || !start2 || !end2) return 0;
    try {
        const referenceDate = new Date();
        const d_start1 = parse(start1, 'HH:mm', referenceDate);
        const d_end1 = parse(end1, 'HH:mm', referenceDate);
        const d_start2 = parse(start2, 'HH:mm', referenceDate);
        const d_end2 = parse(end2, 'HH:mm', referenceDate);
        const overlapStart = new Date(Math.max(d_start1.getTime(), d_start2.getTime()));
        const overlapEnd = new Date(Math.min(d_end1.getTime(), d_end2.getTime()));
        return overlapStart < overlapEnd ? differenceInMinutes(overlapEnd, overlapStart) : 0;
    } catch (e) { return 0; }
}

// --- LOGICA DEFINITIVA A SETACCIO AL MINUTO ---
// Questa funzione calcola quanti minuti di un permesso sono REALI, 
// escludendo pausa pranzo, festività parziali e recuperi orari.
const calculateNetMinutes = (
    reqStart: string, 
    reqEnd: string, 
    user: UserDocument,
    holiday?: HolidayData | null,
    compStartTime?: string | null,
    compEndTime?: string | null
): number => {
    try {
        const toMin = (t: string) => {
            const [h, m] = t.split(':').map(Number);
            return h * 60 + m;
        };

        const rStart = toMin(reqStart);
        const rEnd = toMin(reqEnd);
        const uStart = toMin(user.workStartTime || "08:30");
        const uEnd = toMin(user.workEndTime || "18:30");
        const lStart = toMin(user.lunchStartTime || "12:30");
        const lEnd = toMin(user.lunchEndTime || "14:30");

        let netMinutes = 0;

        for (let m = rStart; m < rEnd; m++) {
            // È tempo di lavoro?
            const isWorkTime = m >= uStart && m < uEnd;
            // È pausa pranzo?
            const isLunchTime = m >= lStart && m < lEnd;
            
            if (isWorkTime && !isLunchTime) {
                // È coperto da festa parziale?
                let isHolidayTime = false;
                if (holiday?.isPartial && holiday.startTime && holiday.endTime) {
                    if (m >= toMin(holiday.startTime) && m < toMin(holiday.endTime)) isHolidayTime = true;
                }

                // È coperto da recupero orario?
                let isCompTime = false;
                if (compStartTime && compEndTime) {
                    if (m >= toMin(compStartTime) && m < toMin(compEndTime)) isCompTime = true;
                }

                if (!isHolidayTime && !isCompTime) {
                    netMinutes++;
                }
            }
        }
        return netMinutes;
    } catch (e) { return 0; }
};

export default function TimesheetsPage() {
    const { user, userProfile, loading: authLoading } = useAuth();
    const { toast } = useToast();

    // --- STATE ---
    const [users, setUsers] = useState<UserDocument[]>([]);
    const [timeOffRequests, setTimeOffRequests] = useState<TimeOffRequest[]>([]);
    const [compensatoryMoveRequests, setCompensatoryMoveRequests] = useState<CompensatoryMoveRequest[]>([]);
    const [holidays, setHolidays] = useState<Map<string, HolidayData>>(new Map());
    const [loading, setLoading] = useState(true);
    const [currentMonth, setCurrentMonth] = useState(new Date());
    const [isMoveDialogOpen, setIsMoveDialogOpen] = useState(false);
    const [moveRequestData, setMoveRequestData] = useState<MoveRequestData | null>(null);
    const [newCompensatoryDay, setNewCompensatoryDay] = useState<WorkDay['day'] | ''>('');
    const [isSubmittingMove, setIsSubmittingMove] = useState(false);
    const [requestToDelete, setRequestToDelete] = useState<CompensatoryMoveRequest | null>(null);

    const isHr = userProfile?.role === 'hr';
    const isAdmin = userProfile?.role === 'admin';
    const isUser = userProfile?.role === 'user';
    const isSuperUser = isHr || isAdmin;

    // Helper per determinare se è festa per un utente specifico
    const checkIsHolidayForUser = (dateStr: string, userDept?: string): HolidayData | null => {
        const holiday = holidays.get(dateStr);
        if (!holiday) return null;
        const depts = holiday.departments || [];
        if (depts.length === 0 || depts.includes(userDept || 'Nessuno')) return holiday;
        return null;
    };

    // Calcola i minuti di riduzione di una festività parziale
    const calculateHolidayMinutes = (holiday: HolidayData, user: UserDocument): number => {
        if (!holiday.isPartial || !holiday.startTime || !holiday.endTime) return 0;
        const uStart = user.workStartTime || "08:30";
        const uEnd = user.workEndTime || "18:30";
        const lStart = user.lunchStartTime || "12:30";
        const lEnd = user.lunchEndTime || "14:30";

        const overlapWithWork = calculateTimeOverlap(holiday.startTime, holiday.endTime, uStart, uEnd);
        const overlapWithLunch = calculateTimeOverlap(holiday.startTime, holiday.endTime, lStart, lEnd);
        
        return Math.max(0, overlapWithWork - overlapWithLunch);
    };

    const handlePrevMonth = () => setCurrentMonth(prev => subMonths(prev, 1));
    const handleNextMonth = () => setCurrentMonth(prev => addMonths(prev, 1));

    // --- DATA FETCHING ---
    useEffect(() => {
        if (!user || !userProfile) return;
        setLoading(true);

        // 1. Caricamento Festività (Listener per l'anno corrente)
        const year = currentMonth.getFullYear().toString();
        const holidayDocRef = doc(db, "holidays", year);
        const holidayUnsub = onSnapshot(holidayDocRef, (docSnap) => {
            if (docSnap.exists()) {
                const holidayData = docSnap.data().dates as HolidayData[];
                const holidayMap = new Map(holidayData.map(h => [
                    h.date, 
                    { date: h.date, name: h.name, departments: h.departments, isPartial: h.isPartial, startTime: h.startTime, endTime: h.endTime }
                ]));
                setHolidays(holidayMap);
            } else {
                setHolidays(new Map());
            }
        });

        let usersUnsub: (() => void) | null = null;
        let requestsUnsub: (() => void) | null = null;
        let moveRequestsUnsub: (() => void) | null = null;
    
        // Helper per identificare le settimane del mese (per i recuperi)
        const getWeekIdsForMonth = (date: Date): string[] => {
            const weeks = new Set<string>();
            const monthStart = startOfMonth(date);
            const monthEnd = endOfMonth(date);
            let currentDate = monthStart;
            while (currentDate <= monthEnd) {
                const weekNumber = getWeek(currentDate, { weekStartsOn: 1 });
                weeks.add(`${currentDate.getFullYear()}-W${weekNumber}`);
                currentDate = addDays(currentDate, 7);
            }
            return Array.from(weeks);
        };
    
        // Configurazione dei listener per permessi e spostamenti
        const setupSubListeners = (userIds: string[]) => {
            if (requestsUnsub) requestsUnsub();
            if (moveRequestsUnsub) moveRequestsUnsub();
            
            if (userIds.length === 0 && !isHr) {
                setTimeOffRequests([]);
                setCompensatoryMoveRequests([]);
                setLoading(false);
                return { requestsUnsub: null, moveRequestsUnsub: null };
            }
    
            const monthStart = startOfMonth(currentMonth);
            const monthEnd = endOfMonth(currentMonth);
            const formattedMonthStart = format(monthStart, "yyyy-MM-dd");
            const formattedMonthEnd = format(monthEnd, "yyyy-MM-dd");

            let requestsQuery;
            if (isHr) {
                requestsQuery = query(
                    collection(db, "timeOffRequests"),
                    where("status", "==", "Approvato"),
                    where("endDate", ">=", formattedMonthStart)
                );
            } else {
                requestsQuery = query(
                    collection(db, "timeOffRequests"),
                    where("status", "==", "Approvato"),
                    where("userId", "in", userIds.length > 0 ? userIds : ["_"]),
                    where("endDate", ">=", formattedMonthStart)
                );
            }

            const newRequestsUnsub = onSnapshot(requestsQuery, (snapshot) => {
                const data = snapshot.docs
                    .map(doc => ({ id: doc.id, ...doc.data() } as TimeOffRequest))
                    .filter(req => req.startDate <= formattedMonthEnd);
                setTimeOffRequests(data);
            });
    
            const weekIdsForMonth = getWeekIdsForMonth(currentMonth);
            const moveUnsubs: (() => void)[] = [];
            if (weekIdsForMonth.length > 0 && userIds.length > 0) {
                userIds.forEach(uid => {
                    const moveQuery = query(collection(db, `users/${uid}/compensatoryMoveRequests`), where("id", "in", weekIdsForMonth));
                    moveUnsubs.push(onSnapshot(moveQuery, (snapshot) => {
                        const newRequests = snapshot.docs.map(doc => doc.data() as CompensatoryMoveRequest);
                        setCompensatoryMoveRequests(prev => [...prev.filter(req => req.userId !== uid), ...newRequests]);
                    }));
                });
            }
    
            return { requestsUnsub: newRequestsUnsub, moveRequestsUnsub: () => moveUnsubs.forEach(unsub => unsub()) };
        };
    
        // Logica di caricamento basata sul Ruolo
        if (isUser) {
            const userDocRef = doc(db, "users", user.uid);
            usersUnsub = onSnapshot(userDocRef, (userDocSnap) => {
                if (userDocSnap.exists()) {
                    const raw = userDocSnap.data();
                    if (raw.status === 'active' && !isExcludedFromPlanning(raw)) {
                        setUsers([{ ...raw, id: userDocSnap.id } as UserDocument]);
                        const listeners = setupSubListeners([user.uid]);
                        requestsUnsub = listeners.requestsUnsub;
                        moveRequestsUnsub = listeners.moveRequestsUnsub;
                    } else {
                        setUsers([]);
                    }
                }
                setLoading(false);
            });
        } else if (isHr) {
            const usersQuery = query(collection(db, "users"), where("status", "==", "active"));
            usersUnsub = onSnapshot(usersQuery, (usersSnapshot) => {
                const usersData = usersSnapshot.docs
                    .map(doc => ({ ...doc.data(), id: doc.id } as UserDocument))
                    .filter(u => !isExcludedFromPlanning(u));
                setUsers(usersData);
                const userIds = usersData.map(u => u.id);
                const listeners = setupSubListeners(userIds);
                requestsUnsub = listeners.requestsUnsub;
                moveRequestsUnsub = listeners.moveRequestsUnsub;
                setLoading(false);
            });
        } else if (isAdmin) {
            const unsubs: (() => void)[] = [];
            let combinedUsers: UserDocument[] = [];
            const ownUserSub = onSnapshot(doc(db, "users", user.uid), (snap) => {
                if (snap.exists() && snap.data()?.status === 'active') {
                    const ownUser = { ...snap.data(), id: snap.id } as UserDocument;
                    combinedUsers = [ownUser, ...combinedUsers.filter(u => u.id !== user.uid)];
                    const filtered = combinedUsers.filter(u => !isExcludedFromPlanning(u));
                    setUsers([...filtered]);
                    const listeners = setupSubListeners(filtered.map(u => u.id));
                    requestsUnsub = listeners.requestsUnsub;
                    moveRequestsUnsub = listeners.moveRequestsUnsub;
                }
            });
            unsubs.push(ownUserSub);
            const managedDepts = userProfile.managedDepartments || [];
            if (managedDepts.length > 0) {
                const deptQuery = query(collection(db, "users"), where("department", "in", managedDepts), where("status", "==", "active"));
                const deptSub = onSnapshot(deptQuery, (snap) => {
                    const deptUsers = snap.docs.filter(d => d.id !== user.uid).map(d => ({ ...d.data(), id: d.id } as UserDocument));
                    combinedUsers = [...combinedUsers.filter(u => u.id === user.uid), ...deptUsers];
                    const filtered = combinedUsers.filter(u => !isExcludedFromPlanning(u));
                    setUsers([...filtered]);
                    const listeners = setupSubListeners(filtered.map(u => u.id));
                    requestsUnsub = listeners.requestsUnsub;
                    moveRequestsUnsub = listeners.moveRequestsUnsub;
                    setLoading(false);
                });
                unsubs.push(deptSub);
            } else {
                setLoading(false);
            }
            usersUnsub = () => unsubs.forEach(unsub => unsub());
        }
    
        return () => {
            if (usersUnsub) usersUnsub();
            if (requestsUnsub) requestsUnsub();
            if (moveRequestsUnsub) moveRequestsUnsub();
            holidayUnsub();
        };
    }, [user, userProfile, currentMonth, isUser, isHr, isAdmin]);

    const pageLoading = loading || authLoading;
    const daysInMonth = getDaysInMonth(currentMonth);

    // --- ELABORAZIONE DATI TABELLA (useMemo) ---
    const timesheetData: TimesheetRow[] = useMemo(() => {
        // 1. Organizziamo le richieste in una mappa [userId][giorno] = Array di richieste
        const userTimeOffMap: { [userId: string]: { [day: number]: TimeOffRequest[] } } = {};
        
        timeOffRequests.forEach(req => {
            if (!userTimeOffMap[req.userId]) { userTimeOffMap[req.userId] = {}; }
            try {
                const interval = { start: startOfDay(parseISO(req.startDate)), end: endOfDay(parseISO(req.endDate)) };
                for (let i = 1; i <= daysInMonth; i++) {
                    const currentDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), i);
                    if (isWithinInterval(currentDate, interval)) {
                        if (!userTimeOffMap[req.userId][i]) userTimeOffMap[req.userId][i] = [];
                        userTimeOffMap[req.userId][i].push(req);
                    }
                }
            } catch(e) { console.error("Invalid date format in request", req.id); }
        });

        // 2. Ciclo principale su ogni utente
        return users.map(user => {
            const dailyData: DayData[] = [];
            let totalMinutes = 0, totalFerieMinutes = 0, totalPermessiMinutes = 0, totalRolMinutes = 0, totalMalattiaMinutes = 0;
            const userWorkSchedule = new Map(user.workSchedule?.map(ws => [ws.day, ws.hours]));
            
            // Orari standard dell'utente
            const uStart = user.workStartTime || "08:30";
            const uEnd = user.workEndTime || "18:30";

            for (let i = 1; i <= daysInMonth; i++) {
                const date = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), i);
                const formattedDate = format(date, "yyyy-MM-dd");
                const dayAbbr = dayMapping[getDay(date)];
                
                // Ore base da contratto
                const originalFullHours = userWorkSchedule.get(dayAbbr) || 0;
                let hoursToday = originalFullHours;
                
                const userLeaveForDay = userTimeOffMap[user.id]?.[i];

                // A. CONTROLLO FESTIVITÀ
                const holiday = checkIsHolidayForUser(formattedDate, user.department);
                let holidayMins = 0;
                let holidayLabelStr = "";

                if (holiday) {
                    if (!holiday.isPartial) {
                        // Festa intera: giornata chiusa
                        dailyData.push({ type: 'holiday', value: holiday.name });
                        continue; 
                    } else {
                        // Festa parziale: riduce le ore pianificate
                        holidayMins = calculateHolidayMinutes(holiday, user);
                        holidayLabelStr = `${holiday.name} (${holiday.startTime}-${holiday.endTime})`;
                        hoursToday = Math.max(0, hoursToday - (holidayMins / 60));
                    }
                }

                // B. CONTROLLO RECUPERO SETTIMANALE
                const weekNumber = getWeek(date, { weekStartsOn: 1 });
                const weekId = `${date.getFullYear()}-W${weekNumber}`;
                const moveRequest = compensatoryMoveRequests.find(req => req.userId === user.id && req.id === weekId);
                const defaultComp = user.weeklyCompensatoryDay;
                
                let isCompDay = (moveRequest?.status === 'approved' && moveRequest.requestedDay === dayAbbr) || (!moveRequest && defaultComp?.day === dayAbbr);

                let compMins = 0;
                let compLabelStr = "";
                if (isCompDay && defaultComp) {
                    // Calcoliamo quanto recupero effettivo c'è (sottraendo eventuale festa parziale già tolta)
                    let overlapHolidayComp = 0;
                    if (holiday?.isPartial && defaultComp.startTime && defaultComp.endTime && holiday.startTime && holiday.endTime) {
                         overlapHolidayComp = calculateTimeOverlap(holiday.startTime, holiday.endTime, defaultComp.startTime, defaultComp.endTime);
                    }
                    compMins = Math.max(0, defaultComp.minutes - overlapHolidayComp);
                    hoursToday = Math.max(0, hoursToday - (compMins / 60));
                    compLabelStr = defaultComp.startTime ? `Recupero (${defaultComp.startTime}-${defaultComp.endTime})` : `Recupero`;
                }

                // C. CONTROLLO PERMESSI (Setaccio al minuto)
                if (userLeaveForDay && userLeaveForDay.length > 0) {
                    let totalDeductibleMinsToday = 0;
                    const labels: string[] = [];
                    if (holidayMins > 0) labels.push(holidayLabelStr);
                    if (isCompDay) labels.push(compLabelStr);

                    userLeaveForDay.forEach(req => {
                        let requestMins = 0;
                        if (req.days === 0 && req.startTime && req.endTime) {
                            // Permesso Orario: USA IL SETACCIO
                            requestMins = calculateNetMinutes(
                                req.startTime, 
                                req.endTime, 
                                user, 
                                holiday, 
                                isCompDay ? defaultComp?.startTime : null, 
                                isCompDay ? defaultComp?.endTime : null
                            );
                        } else {
                            // Permesso Giornata Intera: Prende tutto ciò che era rimasto da lavorare
                            requestMins = hoursToday * 60;
                        }

                        labels.push(`${req.type} (${formatMinutes(requestMins)})`);

                        if (req.type !== 'Recupero Straordinari') {
                            totalDeductibleMinsToday += requestMins;
                            const category = leaveTypeCategories[req.type];
                            if (category === 'ferie') totalFerieMinutes += requestMins;
                            else if (category === 'permessi') totalPermessiMinutes += requestMins;
                            else if (category === 'rol') totalRolMinutes += requestMins;
                            else if (category === 'malattia') totalMalattiaMinutes += requestMins;
                        }
                    });

                    dailyData.push({ type: 'leave', value: labels.join(' + ') });
                    const workedMinsToday = (hoursToday * 60) - totalDeductibleMinsToday;
                    if (workedMinsToday > 0) totalMinutes += workedMinsToday;
                    
                } else {
                    // D. GIORNATA SENZA PERMESSI (Lavoro, Weekend o solo Recupero/Festa)
                    let workedMinsToday = hoursToday * 60;
                    if (workedMinsToday > 0) totalMinutes += workedMinsToday;

                    let displayValue: string | number = originalFullHours;
                    if (holidayMins > 0 || isCompDay) {
                        displayValue = `${formatMinutes(workedMinsToday)} (Lavoro)`;
                    }

                    dailyData.push({ 
                        type: isCompDay ? 'compensatory' : (isWeekend(date) && originalFullHours === 0 ? 'weekend' : 'work'), 
                        value: isCompDay ? (holidayMins > 0 ? `${holidayLabelStr} + ${compLabelStr}` : compLabelStr) : displayValue,
                        holidayLabel: holidayMins > 0 && !isCompDay ? holidayLabelStr : undefined
                    });
                }
            }
            return { 
                userId: user.id, 
                userName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email, 
                dailyData, 
                totalMinutes, 
                totalFerieMinutes, 
                totalPermessiMinutes, 
                totalRolMinutes, 
                totalMalattiaMinutes 
            };
        });
    }, [users, timeOffRequests, compensatoryMoveRequests, holidays, currentMonth, daysInMonth]);

    // --- ESPORTAZIONE CSV (handleDownloadCSV) ---
    const handleDownloadCSV = () => {
        // Funzioni Helper interne per la formattazione oraria del CSV
        const formatDecimalToTime = (decimalHours: number): string => {
            if (decimalHours <= 0) return '0:00';
            const hours = Math.floor(decimalHours);
            const minutes = Math.round((decimalHours - hours) * 60);
            return `${hours}:${minutes.toString().padStart(2, '0')}`;
        };
        const formatMinutesToTime = (totalMinutes: number): string => {
            if (totalMinutes <= 0) return '0:00';
            const hours = Math.floor(totalMinutes / 60);
            const minutes = Math.round(totalMinutes % 60);
            return `${hours}:${minutes.toString().padStart(2, '0')}`;
        };

        const dayHeaders = Array.from({ length: daysInMonth }, (_, i) => {
            const date = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), i + 1);
            return `${format(date, 'EEE', { locale: it })} ${i + 1}`;
        });

        const csvRows: string[][] = [];
        const monthYearHeader = [format(currentMonth, "MMMM yyyy", { locale: it })];
        csvRows.push([...monthYearHeader, ...Array(dayHeaders.length + 3).fill('')]);
        csvRows.push(['', '', ...dayHeaders, 'Totale Pianificate', 'Totale Effettive']);

        // Ciclo su ogni utente per generare le righe del CSV
        users.forEach(user => {
            const userRow = timesheetData.find(ts => ts.userId === user.id);
            if (!userRow) return;

            const userWorkSchedule = new Map(user.workSchedule?.map(ws => [ws.day, ws.hours]));
            const userTimeOff = timeOffRequests.filter(req => req.userId === user.id && req.status === 'Approvato');
            
            let totalPlannedMinutes = 0;
            let totalActualMinutes = 0;
            
            const plannedHours: string[] = [];
            const actualHours: string[] = [];
            const leaveData: { [key: string]: string[] } = {
                'ferie': Array(daysInMonth).fill(''),
                'permessi': Array(daysInMonth).fill(''),
                'rol': Array(daysInMonth).fill(''),
                'malattia': Array(daysInMonth).fill('')
            };

            for (let day = 1; day <= daysInMonth; day++) {
                const date = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
                const formattedDate = format(date, "yyyy-MM-dd");
                const dayAbbr = dayMapping[getDay(date)];
                
                // 1. ORE BASE E FESTIVITÀ
                const originalFullHours = userWorkSchedule.get(dayAbbr) || 0;
                let plannedHoursToday = originalFullHours;

                const holiday = checkIsHolidayForUser(formattedDate, user.department);
                let holidayMins = 0;

                if (holiday && !holiday.isPartial) {
                    plannedHours.push("0:00");
                    actualHours.push("0:00");
                    continue; 
                }

                if (holiday && holiday.isPartial) {
                    holidayMins = calculateHolidayMinutes(holiday, user);
                    plannedHoursToday = Math.max(0, plannedHoursToday - (holidayMins / 60));
                }

                // 2. RECUPERI
                const weekNumber = getWeek(date, { weekStartsOn: 1 });
                const weekId = `${date.getFullYear()}-W${weekNumber}`;
                const moveRequest = compensatoryMoveRequests.find(req => req.userId === user.id && req.id === weekId);
                const defaultComp = user.weeklyCompensatoryDay;
                
                let isCompDay = (moveRequest?.status === 'approved' && moveRequest.requestedDay === dayAbbr) || (!moveRequest && defaultComp?.day === dayAbbr);

                if (isCompDay && defaultComp) {
                    let overlapHolidayComp = 0;
                    if (holiday?.isPartial && defaultComp.startTime && defaultComp.endTime && holiday.startTime && holiday.endTime) {
                         overlapHolidayComp = calculateTimeOverlap(holiday.startTime, holiday.endTime, defaultComp.startTime, defaultComp.endTime);
                    }
                    const effectiveCompMins = Math.max(0, defaultComp.minutes - overlapHolidayComp);
                    plannedHoursToday = Math.max(0, plannedHoursToday - (effectiveCompMins / 60));
                }
                
                // Ore Pianificate Pulite (Debito reale verso l'azienda)
                plannedHours.push(formatDecimalToTime(plannedHoursToday));
                totalPlannedMinutes += plannedHoursToday * 60;

                // 3. PERMESSI (Setaccio al minuto per il CSV)
                const leavesOnThisDay = userTimeOff.filter(req => isWithinInterval(date, { start: parseISO(req.startDate), end: parseISO(req.endDate) }));
                let totalActualMinsToday = plannedHoursToday * 60;

                leavesOnThisDay.forEach(req => {
                    if (req.type !== 'Recupero Straordinari') {
                        let minsToDeduct = 0;
                        if (req.days === 0 && req.startTime && req.endTime) {
                            // USA IL SETACCIO PER IL PERMESSO ORARIO
                            minsToDeduct = calculateNetMinutes(
                                req.startTime, 
                                req.endTime, 
                                user, 
                                holiday, 
                                isCompDay ? defaultComp?.startTime : null, 
                                isCompDay ? defaultComp?.endTime : null
                            );
                        } else {
                            // Permesso Giornata Intera: copre le ore pianificate residue
                            minsToDeduct = plannedHoursToday * 60;
                        }

                        totalActualMinsToday -= minsToDeduct;
                        const categoryKey = leaveTypeCategories[req.type] || 'permessi';
                        if (leaveData[categoryKey]) {
                            const current = parseFloat((leaveData[categoryKey][day - 1] || "0:00").replace(':', '.')) * 60;
                            leaveData[categoryKey][day - 1] = formatMinutesToTime(current + minsToDeduct);
                        }
                    }
                });

                actualHours.push(formatMinutesToTime(Math.max(0, totalActualMinsToday)));
                totalActualMinutes += Math.max(0, totalActualMinsToday);
            }

            csvRows.push([userRow.userName, '', ...Array(dayHeaders.length + 2).fill('')]);
            csvRows.push(['', 'Ore di lavoro pianificate', ...plannedHours, formatMinutesToTime(totalPlannedMinutes), '']);
            csvRows.push(['', 'Ore di lavoro effettive', ...actualHours, '', formatMinutesToTime(totalActualMinutes)]);

            Object.entries(leaveData).forEach(([leaveType, days]) => {
                if (days.some(day => day !== '')) {
                    const capitalizedLeaveType = leaveType.charAt(0).toUpperCase() + leaveType.slice(1);
                    csvRows.push(['', capitalizedLeaveType, ...days, '', '']);
                }
            });

            csvRows.push(Array(dayHeaders.length + 4).fill(''));
        });
        
        // Generazione del file Blob e download
        const csvContent = csvRows.map(row => row.map(cell => `"${String(cell)}"`).join(';')).join('\n');
        const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        const fileName = `PRESENZE_${format(currentMonth, "MMMM_yyyy", { locale: it }).toUpperCase()}.csv`;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url); // Frees browser blob memory
        toast({ title: "Download Avviato", description: `Il file ${fileName} è in fase di download.` });
    };

    // --- GESTIONE SPOSTAMENTI RECUPERO ---

    const handleMoveRequestClick = (data: MoveRequestData) => {
        setMoveRequestData(data);
        setIsMoveDialogOpen(true);
        setNewCompensatoryDay('');
    };

    const handleSubmitMoveRequest = async () => {
        if (!moveRequestData || !newCompensatoryDay || !userProfile) return;
        setIsSubmittingMove(true);
        const { weekId, user: targetUser } = moveRequestData;
        const defaultCompensatoryDay = targetUser.weeklyCompensatoryDay;
        
        if (!defaultCompensatoryDay) {
            toast({ variant: "destructive", title: "Errore", description: "L'utente non ha un giorno di recupero predefinito." });
            setIsSubmittingMove(false);
            return;
        }

        const requestDoc: CompensatoryMoveRequest = {
            id: weekId,
            status: 'pending',
            requestedDay: newCompensatoryDay,
            originalDay: defaultCompensatoryDay.day,
            minutes: defaultCompensatoryDay.minutes,
            userId: targetUser.id,
            userName: `${targetUser.firstName || ''} ${targetUser.lastName || ''}`.trim(),
            requestedAt: serverTimestamp(),
        };

        try {
            const docRef = doc(db, `users/${targetUser.id}/compensatoryMoveRequests`, weekId);
            await setDoc(docRef, requestDoc);
            toast({ title: "Richiesta Inviata", description: "La tua richiesta di spostamento è stata inviata per l'approvazione." });
            setIsMoveDialogOpen(false);
        } catch (error) {
            console.error("Error submitting move request:", error);
            toast({ variant: "destructive", title: "Errore", description: "Impossibile inviare la richiesta." });
        } finally {
            setIsSubmittingMove(false);
        }
    };

    const handleDeleteMoveRequest = async () => {
        if (!requestToDelete) return;
        try {
            const docRef = doc(db, `users/${requestToDelete.userId}/compensatoryMoveRequests`, requestToDelete.id);
            await deleteDoc(docRef);
            toast({ title: "Richiesta Eliminata", description: "La richiesta di spostamento recupero è stata eliminata." });
        } catch (error) {
            console.error("Error deleting move request:", error);
            toast({ variant: "destructive", title: "Errore", description: "Impossibile eliminare la richiesta." });
        } finally {
            setRequestToDelete(null);
        }
    };

    // --- UI HELPERS & DATA ---

    function TimesheetSkeleton() {
        return (
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Dipendente</TableHead>
                        <TableHead>Ore Lavorate</TableHead>
                        <TableHead>Ferie</TableHead>
                        <TableHead>Permessi</TableHead>
                        <TableHead>ROL</TableHead>
                        <TableHead>Malattia</TableHead>
                        <TableHead className="text-right">Dettaglio</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {[...Array(5)].map((_, i) => (
                        <TableRow key={i}>
                            <TableCell><Skeleton className="h-4 w-[150px]" /></TableCell>
                            <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                            <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                            <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                            <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                            <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                            <TableCell className="text-right"><Skeleton className="h-8 w-8 rounded-md" /></TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        );
    }

    const userTimesheet = timesheetData.length > 0 ? timesheetData[0] : null;
    
    // Giorni disponibili per lo spostamento del recupero (escludendo il giorno attuale di recupero)
    const workDaysForSelect = useMemo(() => 
        userProfile?.workSchedule?.map(d => d.day).filter(day => day !== userProfile.weeklyCompensatoryDay?.day) || [], 
        [userProfile]
    );

    const summaryCards = userTimesheet ? [
        { title: "Ore Lavorate", value: formatMinutes(userTimesheet.totalMinutes), icon: Clock },
        { title: "Ferie", value: formatMinutes(userTimesheet.totalFerieMinutes), icon: CalendarOff },
        { title: "Permessi", value: formatMinutes(userTimesheet.totalPermessiMinutes), icon: Briefcase },
        { title: "ROL", value: formatMinutes(userTimesheet.totalRolMinutes), icon: Briefcase },
        { title: "Malattia", value: formatMinutes(userTimesheet.totalMalattiaMinutes), icon: Pill },
    ] : [];

    // --- RENDERING PRINCIPALE ---

    return (
        <AlertDialog open={!!requestToDelete} onOpenChange={(open) => !open && setRequestToDelete(null)}>
            <div className="flex flex-col gap-8">
                {/* INTESTAZIONE E CONTROLLI */}
                <div>
                    <h1 className="font-headline text-3xl font-semibold">Foglio Ore</h1>
                    <p className="text-muted-foreground">
                        {isSuperUser ? 'Visualizza e gestisci i fogli presenze di tutta l\'organizzazione.' : 'Controlla il riepilogo delle tue ore e la tua disponibilità.'}
                    </p>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="icon" onClick={handlePrevMonth} disabled={pageLoading}>
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <span className="font-headline text-lg font-semibold capitalize w-40 text-center">
                            {pageLoading ? <Loader2 className="h-5 w-5 animate-spin mx-auto" /> : format(currentMonth, "MMMM yyyy", { locale: it })}
                        </span>
                        <Button variant="outline" size="icon" onClick={handleNextMonth} disabled={pageLoading}>
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>

                    {isSuperUser && (
                        <Button variant="outline" onClick={handleDownloadCSV} disabled={pageLoading || timesheetData.length === 0} className="w-full sm:w-auto">
                            <Download className="h-4 w-4 mr-2" /> Esporta CSV
                        </Button>
                    )}
                </div>

                {/* VISTA SUPERUSER (TABELLA RIEPILOGATIVA) O VISTA UTENTE (CARDS) */}
                {isSuperUser ? (
                    <Card>
                        <CardHeader>
                            <CardTitle>Riepilogo Ore Mensili</CardTitle>
                            <CardDescription>
                                Totali ore per il mese di {format(currentMonth, "MMMM yyyy", { locale: it })}. Clicca su "Dettaglio" per la vista giornaliera.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {pageLoading ? <TimesheetSkeleton /> : (
                                // La tabella SuperUser verrà inserita nel prossimo blocco
                                <div id="superuser-table-placeholder" />
                            )}
                        </CardContent>
                    </Card>
                ) : (
                    <div className="flex flex-col gap-8">
                        {/* KPI CARDS PER UTENTE SINGOLO */}
                        {pageLoading ? (
                            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
                                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
                            </div>
                        ) : userTimesheet ? (
                            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
                                {summaryCards.map((card) => (
                                    <Card key={card.title}>
                                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                            <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
                                            <card.icon className="h-5 w-5 text-muted-foreground" />
                                        </CardHeader>
                                        <CardContent>
                                            <div className="text-2xl font-bold">{card.value}</div>
                                        </CardContent>
                                    </Card>
                                ))}
                            </div>
                        ) : null}
                        
                        {/* La tabella Dettaglio Giornaliero per Utente verrà inserita nel prossimo blocco */}
                        <div id="user-detail-placeholder" />
                    </div>
                )}

                {/* --- 1. TABELLA RIEPILOGATIVA PER SUPERUSER --- */}
                {isSuperUser && !pageLoading && (
                    timesheetData.length > 0 ? (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Dipendente</TableHead>
                                    <TableHead>Ore Lavorate</TableHead>
                                    <TableHead>Ferie</TableHead>
                                    <TableHead>Permessi</TableHead>
                                    <TableHead>ROL</TableHead>
                                    <TableHead>Malattia</TableHead>
                                    <TableHead className="text-right">Azione</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {timesheetData.map(row => (
                                    <TableRow key={row.userId}>
                                        <TableCell className="font-medium">{row.userName}</TableCell>
                                        <TableCell>{formatMinutes(row.totalMinutes)}</TableCell>
                                        <TableCell>{formatMinutes(row.totalFerieMinutes)}</TableCell>
                                        <TableCell>{formatMinutes(row.totalPermessiMinutes)}</TableCell>
                                        <TableCell>{formatMinutes(row.totalRolMinutes)}</TableCell>
                                        <TableCell>{formatMinutes(row.totalMalattiaMinutes)}</TableCell>
                                        <TableCell className="text-right">
                                            <Sheet>
                                                <SheetTrigger asChild>
                                                    <Button variant="outline" size="sm"><Eye className="mr-2 h-4 w-4" /> Dettaglio</Button>
                                                </SheetTrigger>
                                                <SheetContent className="max-w-full w-full sm:max-w-4xl flex flex-col p-0">
                                                    <SheetHeader className="p-6 border-b">
                                                        <SheetTitle>Dettaglio Giornaliero: {row.userName}</SheetTitle>
                                                        <SheetDescription>Visualizzazione per il mese di {format(currentMonth, "MMMM yyyy", { locale: it })}.</SheetDescription>
                                                    </SheetHeader>
                                                    <div className="flex-1 overflow-auto p-6">
                                                        <Table className="whitespace-nowrap">
                                                            <TableHeader>
                                                                <TableRow>
                                                                    <TableHead>Giorno</TableHead>
                                                                    <TableHead>Stato/Ore</TableHead>
                                                                    <TableHead className="text-right">Azione</TableHead>
                                                                </TableRow>
                                                            </TableHeader>
                                                            <TableBody>
                                                                {row.dailyData.map((dayData, index) => {
                                                                    const date = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), index + 1);
                                                                    const weekId = `${date.getFullYear()}-W${getWeek(date, { weekStartsOn: 1 })}`;
                                                                    const existingRequest = compensatoryMoveRequests.find(r => r.userId === row.userId && r.id === weekId);
                                                                    const canDelete = isSuperUser && existingRequest && existingRequest.status !== 'pending';
                                                                    
                                                                    return (
                                                                        <TableRow key={index} className={cn(
                                                                            dayData.type === 'holiday' ? 'bg-amber-100/50 dark:bg-amber-900/20' : '',
                                                                            dayData.type === 'weekend' ? 'bg-muted/30' : '',
                                                                            dayData.type === 'leave' ? "bg-blue-50/50 dark:bg-blue-900/10" : "",
                                                                            dayData.type === 'compensatory' ? "bg-green-50/50 dark:bg-green-900/10" : ""
                                                                        )}>
                                                                            <TableCell className="font-medium capitalize">{format(date, "eeee d", { locale: it })}</TableCell>
                                                                            <TableCell className={cn("font-semibold", dayData.value === 0 ? 'text-muted-foreground' : '')}>
                                                                                {dayData.type === 'work' && typeof dayData.value === 'number' ? `${String(dayData.value).replace('.', ',')} ore` : String(dayData.value)}
                                                                                {dayData.holidayLabel && <div className="text-[10px] font-normal text-amber-600 mt-0.5">{dayData.holidayLabel}</div>}
                                                                            </TableCell>
                                                                            <TableCell className="text-right">
                                                                                {canDelete && (
                                                                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => setRequestToDelete(existingRequest)}>
                                                                                        <Trash2 className="h-4 w-4" />
                                                                                    </Button>
                                                                                )}
                                                                                {dayData.moveRequestStatus && <Badge variant={dayData.moveRequestStatus === 'rejected' ? 'destructive' : 'outline'}>{dayData.moveRequestStatus === 'pending' ? 'Sospeso' : 'Rifiutato'}</Badge>}
                                                                            </TableCell>
                                                                        </TableRow>
                                                                    );
                                                                })}
                                                            </TableBody>
                                                        </Table>
                                                    </div>
                                                </SheetContent>
                                            </Sheet>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    ) : (
                        <div className="text-center p-8 text-muted-foreground">Nessun dipendente trovato per il periodo selezionato.</div>
                    )
                )}

                {/* --- 2. TABELLA DETTAGLIO PER UTENTE STANDARD --- */}
                {!isSuperUser && !pageLoading && userTimesheet && (
                    <Card>
                        <CardHeader>
                            <CardTitle>Dettaglio Giornaliero</CardTitle>
                            <CardDescription>Riepilogo delle tue ore per il mese di {format(currentMonth, "MMMM yyyy", { locale: it })}.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-[200px]">Giorno</TableHead>
                                        <TableHead>Ore/Stato</TableHead>
                                        <TableHead className="text-right">Azione</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {userTimesheet.dailyData.map((dayData, index) => {
                                        const date = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), index + 1);
                                        const weekNumber = getWeek(date, { weekStartsOn: 1 });
                                        const weekId = `${date.getFullYear()}-W${weekNumber}`;
                                        const existingRequestForWeek = compensatoryMoveRequests.find(r => r.id === weekId && r.userId === user?.uid);
                                        const canRequestMove = dayData.type === 'compensatory' && !dayData.isCompensatoryMoved && !existingRequestForWeek;

                                        return (
                                            <TableRow key={index} className={cn(
                                                dayData.type === 'holiday' ? 'bg-amber-100/50' : '',
                                                dayData.type === 'weekend' ? 'bg-muted/30' : '',
                                                dayData.type === 'leave' ? "bg-blue-50/50" : "",
                                                dayData.type === 'compensatory' ? "bg-green-50/50" : ""
                                            )}>
                                                <TableCell className="font-medium capitalize">{format(date, "eeee d", { locale: it })}</TableCell>
                                                <TableCell className={cn("font-semibold", dayData.value === 0 ? 'text-muted-foreground' : '')}>
                                                    {dayData.type === 'work' && typeof dayData.value === 'number' ? `${String(dayData.value).replace('.', ',')} ore` : String(dayData.value)}
                                                    {dayData.holidayLabel && <div className="text-[10px] font-normal text-amber-600 mt-0.5">{dayData.holidayLabel}</div>}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    {canRequestMove && (
                                                        <Button variant="ghost" size="sm" onClick={() => handleMoveRequestClick({ weekId, weekNumber, year: date.getFullYear(), user: users[0] })}>
                                                            <ArrowRightLeft className="mr-2 h-4 w-4" /> Sposta
                                                        </Button>
                                                    )}
                                                    {dayData.moveRequestStatus && <Badge variant={dayData.moveRequestStatus === 'rejected' ? 'destructive' : 'outline'}>{dayData.moveRequestStatus === 'pending' ? 'Richiesta Inviata' : 'Rifiutato'}</Badge>}
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                )}

                {/* --- 3. DIALOGHI --- */}
                <Dialog open={isMoveDialogOpen} onOpenChange={setIsMoveDialogOpen}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Richiedi Spostamento Recupero</DialogTitle>
                            <DialogDescription>Richiedi di spostare il tuo giorno di recupero per la settimana {moveRequestData?.weekNumber} del {moveRequestData?.year}.</DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
                            <div className="space-y-2">
                                <Label htmlFor="new-day">Seleziona il nuovo giorno</Label>
                                <Select value={newCompensatoryDay} onValueChange={(value) => setNewCompensatoryDay(value as WorkDay['day'])}>
                                    <SelectTrigger id="new-day"><SelectValue placeholder="Seleziona un giorno..." /></SelectTrigger>
                                    <SelectContent>
                                        {workDaysForSelect.map(day => <SelectItem key={day} value={day}>{day}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <DialogFooter>
                            <DialogClose asChild><Button type="button" variant="secondary">Annulla</Button></DialogClose>
                            <Button type="submit" onClick={handleSubmitMoveRequest} disabled={!newCompensatoryDay || isSubmittingMove}>
                                {isSubmittingMove && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Invia Richiesta
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Sei assolutamente sicuro?</AlertDialogTitle>
                        <AlertDialogDescription>Questa azione ripristinerà il giorno di recupero predefinito eliminando la richiesta di spostamento approvata.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Annulla</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDeleteMoveRequest}>Sì, elimina</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </div>
        </AlertDialog>
    );
}
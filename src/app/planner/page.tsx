
"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useAuth, UserProfile } from "@/app/layout";
import { collection, query, where, onSnapshot, collectionGroup } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ChevronRight, Search, Minus, Plus, AlertTriangle } from "lucide-react";
import { USER_ROLES, isExcludedFromPlanning } from "@/lib/constants";
import { addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, format, getDay, getWeek, parseISO, isWeekend, parse, differenceInMinutes } from "date-fns";
import { it } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

// --- CONFIGURATION ---


// --- INTERFACES ---

interface TimeOffRequest {
  id: string;
  userId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  startTime?: string | null;
  endTime?: string | null;
  days: number;
  type: string;
  status: string;
  isArchived?: boolean;
}

interface CompensatoryMoveRequest {
    id: string;
    status: 'pending' | 'approved' | 'rejected';
    requestedDay: string;
    userId: string;
}

interface Holiday {
    date: string;
    name: string;
    departments?: string[];
    isPartial?: boolean;
    startTime?: string | null;
    endTime?: string | null;
}

// Helper for days
const dayMapping: { [key: number]: string } = { 0: 'DOM', 1: 'LUN', 2: 'MAR', 3: 'MER', 4: 'GIO', 5: 'VEN', 6: 'SAB' };

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
        
        if (overlapStart < overlapEnd) {
            return differenceInMinutes(overlapEnd, overlapStart);
        }
        return 0;
    } catch (e) {
        return 0;
    }
}

export default function PlannerPage() {
  // --- STATE MANAGEMENT ---
  const { userProfile, loading: authLoading } = useAuth();
  
  // Data State
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [allRequests, setAllRequests] = useState<TimeOffRequest[]>([]);
  const [approvedMoves, setApprovedMoves] = useState<CompensatoryMoveRequest[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  
  // View State
  const [loading, setLoading] = useState(true);
  const [viewDate, setViewDate] = useState(startOfMonth(new Date()));
  
  // Zoom & Search State
  const [zoomLevel, setZoomLevel] = useState([30]);
  const [searchTerm, setSearchTerm] = useState("");

  const isSuperUser = userProfile?.role === USER_ROLES.ADMIN || userProfile?.role === USER_ROLES.HR;

  // --- DATA FETCHING ---
  useEffect(() => {
    if (authLoading) return;
    
    if (!isSuperUser) {
      setLoading(false);
      return;
    }
    
    setLoading(true);

    // 1. Fetch Users, Only the active ones
    const usersSub = onSnapshot(
            query(
                collection(db, "users"), 
                where("status", "==", "active") // Filters out deleted users
            ), 
            (snap) => {
                const usersData = snap.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                } as UserProfile));
                setAllUsers(usersData);
            }
        );

    // 2. Fetch Active Requests
    const requestsSub = onSnapshot(query(collection(db, "timeOffRequests")), (snap) => {
        const liveData = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as TimeOffRequest));
        
        // We need to merge with archive data, so we use a functional state update
        setAllRequests(prev => {
            // Keep existing archive data, replace live data
            const archiveOnly = prev.filter(r => r.isArchived); 
            return [...archiveOnly, ...liveData];
        });
    });

    // 3. Fetch Archived Requests (Read-only historical data)
    const archiveSub = onSnapshot(query(collection(db, "archive_timeOffRequests")), (snap) => {
        // We use 'as unknown as TimeOffRequest' to tell TypeScript to trust us about the data shape
        const archivedRequests = snap.docs.map(doc => ({ 
            id: doc.id, 
            ...doc.data(), 
            isArchived: true 
        } as unknown as TimeOffRequest));
        
        setAllRequests(prev => {
            const liveOnly = prev.filter(r => !r.isArchived);
            return [...liveOnly, ...archivedRequests];
        });
    });

    // 4. Fetch Approved Move Requests
    const movesSub = onSnapshot(query(collectionGroup(db, 'compensatoryMoveRequests'), where('status', '==', 'approved')), (snap) => {
        setApprovedMoves(snap.docs.map(doc => doc.data() as CompensatoryMoveRequest));
    });

    // 5. Fetch Holidays
    const holidaysSub = onSnapshot(query(collection(db, "holidays")), (snap) => {
        let allHolidays: Holiday[] = [];
        snap.forEach(doc => { allHolidays = [...allHolidays, ...(doc.data().dates as Holiday[])]; });
        setHolidays(allHolidays);
    });

    // Stop loading spinner after a short delay to allow data to settle
    const timeout = setTimeout(() => setLoading(false), 1000);

    return () => {
        usersSub();
        requestsSub();
        archiveSub();
        movesSub();
        holidaysSub();
        clearTimeout(timeout);
    };
  }, [authLoading, isSuperUser]);

  // --- DATA PROCESSING (Versione Definitiva con Logica Oraria) ---
  const { gridRows, dateColumns, monthSpans, globalHolidays } = useMemo(() => {
    if (allUsers.length === 0) return { gridRows: [], dateColumns: [], monthSpans: [], globalHolidays: new Set<string>() };

    const startDate = startOfMonth(viewDate);
    const endDate = endOfMonth(addMonths(startDate, 5));
    const dateColumns = eachDayOfInterval({ start: startDate, end: endDate });

    // 1. Calcolo Spans dei Mesi per l'intestazione superiore
    const monthSpans: { label: string; span: number }[] = [];
    let currentMonthLabel = "";
    let currentSpan = 0;

    dateColumns.forEach((day, index) => {
        const label = format(day, 'MMMM yyyy', { locale: it });
        if (label !== currentMonthLabel) {
            if (currentMonthLabel) monthSpans.push({ label: currentMonthLabel, span: currentSpan });
            currentMonthLabel = label;
            currentSpan = 1;
        } else {
            currentSpan++;
        }
        if (index === dateColumns.length - 1) monthSpans.push({ label: currentMonthLabel, span: currentSpan });
    });

    // 2. Mappa Festività Globali (per colorare la testata della colonna)
    const globalHolidays = new Set<string>();
    holidays.forEach(h => {
        if (!h.departments || h.departments.length === 0) globalHolidays.add(h.date);
    });

    // Helper per trovare la festa specifica di un utente
    const getHolidayForUser = (dateStr: string, dept?: string) => {
        const holiday = holidays.find(h => h.date === dateStr);
        if (!holiday) return null;
        const depts = holiday.departments || [];
        if (depts.length === 0 || depts.includes(dept || 'Nessuno')) return holiday;
        return null;
    };

    const movesMap = new Map<string, CompensatoryMoveRequest>();
    approvedMoves.forEach(m => movesMap.set(`${m.userId}_${m.id}`, m));

    // 3. Raggruppamento Utenti per Dipartimento e Filtro Ricerca
    const usersByDept: Record<string, UserProfile[]> = {};
    allUsers
      .filter(u => {
        if (isExcludedFromPlanning(u)) return false;
        if (searchTerm === "") return true;
        const term = searchTerm.toLowerCase();
        const fullName = `${u.firstName || ''} ${u.lastName || ''}`.toLowerCase();
        const department = (u.department || '').toLowerCase();
        return fullName.includes(term) || department.includes(term);
      })
      .forEach(u => {
        const dept = u.department || 'Nessun Dipartimento';
        if (!usersByDept[dept]) usersByDept[dept] = [];
        usersByDept[dept].push(u);
      });

    // 4. Costruzione Righe della Griglia
    const gridRows: any[] = [];
    const dayIndexToAbbr = ['DOM', 'LUN', 'MAR', 'MER', 'GIO', 'VEN', 'SAB'];

    Object.keys(usersByDept).sort().forEach(deptName => {
        gridRows.push({ type: 'department', label: deptName });

        usersByDept[deptName]
            .sort((a, b) => (`${a.lastName || ''}${a.firstName || ''}`).localeCompare(`${b.lastName || ''}${b.firstName || ''}`))
            .forEach(user => {
                const userRequestsMap: Record<string, TimeOffRequest[]> = {};
                const userRawRequests = allRequests.filter(r => r.userId === user.id);
                
                userRawRequests.forEach(req => {
                    const reqStart = parseISO(req.startDate);
                    const reqEnd = parseISO(req.endDate);
                    if (reqEnd < startDate || reqStart > endDate) return;
                    const reqDays = eachDayOfInterval({ 
                        start: reqStart < startDate ? startDate : reqStart, 
                        end: reqEnd > endDate ? endDate : reqEnd 
                    });
                    reqDays.forEach(d => {
                        const key = format(d, 'yyyy-MM-dd');
                        if (!userRequestsMap[key]) userRequestsMap[key] = [];
                        userRequestsMap[key].push(req);
                    });
                });

                const cells = dateColumns.map(date => {
                    const dateStr = format(date, 'yyyy-MM-dd');
                    const dayAbbr = dayMapping[getDay(date)];
                    const userHoliday = getHolidayForUser(dateStr, user.department);
                    
                    // 1. FESTA INTERA: Priorità assoluta
                    if (userHoliday && !userHoliday.isPartial) {
                        return { type: 'holiday', color: 'bg-amber-100', tooltip: `Festività: ${userHoliday.name}`, label: '' };
                    }

                    // 2. WEEKEND
                    if (isWeekend(date)) return { type: 'weekend', color: 'bg-slate-50', tooltip: '' };

                    // 3. RECUPERO SETTIMANALE (Calcolo orario)
                    const weekId = `${format(date, 'yyyy')}-W${getWeek(date, { weekStartsOn: 1 })}`;
                    const moveReq = movesMap.get(`${user.id}_${weekId}`);
                    const defaultComp = user.weeklyCompensatoryDay;
                    
                    let isCompDay = false;
                    let compStart = defaultComp?.startTime;
                    let compEnd = defaultComp?.endTime;

                    if (moveReq?.status === 'approved' && moveReq.requestedDay === dayAbbr) {
                        isCompDay = true;
                    } else if (!moveReq && defaultComp?.day === dayAbbr) {
                        isCompDay = true;
                    }

                    // 4. PERMESSI / FERIE
                    const dailyRequests = userRequestsMap[dateStr];
                    if (dailyRequests && dailyRequests.length > 0) {
                        const req = dailyRequests[0];
                        const isPartialLeave = req.days === 0 && req.startTime && req.endTime;
                        
                        let colorClass = "";
                        if (req.status === 'In Sospeso') {
                            colorClass = "bg-[repeating-linear-gradient(45deg,_#fbbf24_0,_#fbbf24_5px,_#fef3c7_5px,_#fef3c7_10px)]";
                        } else {
                            const typeKey = req.type as string;
                            const isP = isPartialLeave;
                            switch(typeKey) {
                                case 'Recupero Straordinari': colorClass = isP ? "bg-purple-300" : "bg-purple-600"; break;
                                case 'Malattia': colorClass = isP ? "bg-orange-300" : "bg-orange-500"; break;
                                case 'ROL': colorClass = isP ? "bg-pink-300" : "bg-pink-600"; break;    
                                default: colorClass = isP ? "bg-blue-300" : "bg-blue-600"; break;
                            }
                        }

                        let label = "";
                        let tooltip = `${req.type} - ${req.status}`;

                        if (isPartialLeave) {
                            label = `${req.startTime}-${req.endTime}`;
                            tooltip += ` (${label})`;
                        } else {
                            // Per i permessi interi, calcoliamo le ore effettive residue
                            const schedDay = user.workSchedule?.find(d => d.day === dayAbbr);
                            let hours = schedDay ? schedDay.hours : 8;
                            
                            // Sottrae sovrapposizione con festa parziale
                            if (userHoliday?.isPartial && userHoliday.startTime && userHoliday.endTime) {
                                const overlap = calculateTimeOverlap(userHoliday.startTime, userHoliday.endTime, user.workStartTime || "08:30", user.workEndTime || "18:30");
                                hours -= (overlap / 60);
                            }
                            // Sottrae sovrapposizione con recupero orario
                            if (isCompDay && compStart && compEnd) {
                                const overlap = calculateTimeOverlap(compStart, compEnd, user.workStartTime || "08:30", user.workEndTime || "18:30");
                                hours -= (overlap / 60);
                            }
                            label = `${Math.round(hours * 10) / 10}h`;
                        }

                        return { type: 'leave', color: colorClass, tooltip, label, isPartial: isPartialLeave };
                    }

                    // 5. SE NON CI SONO PERMESSI, MOSTRA RECUPERO O FESTA PARZIALE
                    if (isCompDay) {
                        let label = "Recupero";
                        if (compStart && compEnd) label = `${compStart}-${compEnd}`;
                        return { type: 'compensatory', color: 'bg-green-200', tooltip: 'Giorno di Recupero', label };
                    }

                    if (userHoliday?.isPartial) {
                        return { 
                            type: 'holiday', 
                            color: 'bg-amber-50 border border-amber-200', 
                            tooltip: `Festa Parziale: ${userHoliday.name} (${userHoliday.startTime}-${userHoliday.endTime})`,
                            label: `${userHoliday.startTime}-${userHoliday.endTime}` 
                        };
                    }

                    return { type: 'empty', color: 'bg-white', tooltip: '' };
                });

                gridRows.push({ type: 'user', user, cells });
            });
    });

    return { gridRows, dateColumns, monthSpans, globalHolidays };
  }, [allUsers, allRequests, holidays, approvedMoves, viewDate, searchTerm]);

  // --- UI HANDLERS ---
  const handlePrevPeriod = () => setViewDate(prev => subMonths(prev, 1));
  const handleNextPeriod = () => setViewDate(prev => addMonths(prev, 1));

  // --- LAYOUT CONSTANTS ---
  const cellWidth = zoomLevel[0]; 
  const nameColumnWidth = 200; 
  const rowHeight = 32; 
  const monthHeaderHeight = 30;
  const dayHeaderHeight = 40;

  const rangeStart = startOfMonth(viewDate);
  const rangeEnd = endOfMonth(addMonths(rangeStart, 5));

  // --- MAIN RENDER ---
  // --- ACCESS CONTROL CHECK ---
  if (!authLoading && !isSuperUser) {
    return (
        <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
            <h1 className="font-headline text-2xl font-semibold">Accesso Negato</h1>
            <p className="text-muted-foreground mt-2">Non hai i permessi per visualizzare il Planner.</p>
        </div>
    );
  }


  return (
    <TooltipProvider>
    <div className="flex flex-col h-[calc(100vh-1px)] w-full min-w-0 gap-4 p-2">
        {/* 1. TOP CONTROL BAR */}
        <div className="flex flex-row flex-start items-center gap-4 bg-card p-3 rounded-lg border shadow-sm flex-none">
            <div className="flex items-center gap-4">
                <div>
                    <h1 className="font-headline text-2xl font-bold">Planner</h1>
                    <p className="text-xs text-muted-foreground hidden sm:block">Panoramica semestrale</p>
                </div>
                <div className="flex items-center gap-1 bg-muted/50 p-1 rounded-md">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handlePrevPeriod}><ChevronLeft className="h-4 w-4"/></Button>
                    <span className="text-sm font-medium w-48 text-center capitalize">
                        {format(rangeStart, 'MMM yyyy', {locale: it})} - {format(rangeEnd, 'MMM yyyy', {locale: it})}
                    </span>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleNextPeriod}><ChevronRight className="h-4 w-4"/></Button>
                </div>
            </div>
            
            <div className="flex items-center gap-4 w-full xl:w-auto">
                <div className="relative flex-1 xl:w-64">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Cerca..." className="pl-8 h-9 text-sm" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                </div>
                <div className="flex items-center gap-2 w-32 md:w-48">
                    <Minus className="h-3 w-3 text-muted-foreground"/>
                    <Slider value={zoomLevel} onValueChange={setZoomLevel} min={20} max={80} step={5} />
                    <Plus className="h-3 w-3 text-muted-foreground"/>
                </div>
            </div>
        </div>

        {/* 2. LEGEND */}
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground px-2">
            <div className="flex items-center gap-1"><div className="w-3 h-3 bg-blue-600 rounded-sm"></div>Ferie</div>
            <div className="flex items-center gap-1"><div className="w-3 h-3 bg-blue-300 rounded-sm"></div>Ferie (Parziale)</div>
            <div className="flex items-center gap-1"><div className="w-3 h-3 bg-pink-600 rounded-sm"></div>ROL</div>
            <div className="flex items-center gap-1"><div className="w-3 h-3 bg-pink-300 rounded-sm"></div>ROL (Parziale)</div>
            <div className="flex items-center gap-1"><div className="w-3 h-3 bg-orange-500 rounded-sm"></div>Malattia</div>
            <div className="flex items-center gap-1"><div className="w-3 h-3 bg-orange-300 rounded-sm"></div>Malattia (Parziale)</div>
            <div className="flex items-center gap-1"><div className="w-3 h-3 bg-purple-600 rounded-sm"></div>Recupero Straordinari</div>
            <div className="flex items-center gap-1"><div className="w-3 h-3 bg-[repeating-linear-gradient(45deg,_#fbbf24_0,_#fbbf24_5px,_#fef3c7_5px,_#fef3c7_10px)] rounded-sm border border-amber-400"></div>In Sospeso</div>
            <div className="flex items-center gap-1"><div className="w-3 h-3 bg-green-200 rounded-sm"></div>Recupero</div>
            <div className="flex items-center gap-1"><div className="w-3 h-3 bg-amber-100 rounded-sm"></div>Festivo</div>
        </div>

        {/* 3. THE MAIN GRID CONTAINER */}
        <div className="flex-1 overflow-hidden border rounded-lg bg-white shadow-sm relative">
            {loading ? (
                 <div className="p-8 space-y-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
            ) : (
                <div 
                    className="overflow-auto h-full w-full relative"
                    style={{
                        display: 'grid',
                        gridTemplateColumns: `${nameColumnWidth}px repeat(${dateColumns.length}, ${cellWidth}px)`,
                        // Row 1 (Months), Row 2 (Days), Rest (Data)
                        gridTemplateRows: `${monthHeaderHeight}px ${dayHeaderHeight}px repeat(${gridRows.length}, ${rowHeight}px)`,
                    }}
                >
                    {/* --- ROW 1: MONTH HEADERS --- */}
                    {/* Top-Left Corner (Empty) */}
                    <div 
                        className="sticky left-0 top-0 z-30 bg-gray-50 border-b border-r"
                        style={{ gridRow: "1 / span 2" }} // Span both header rows
                    >
                        <div className="h-full flex items-center justify-center font-bold text-sm text-muted-foreground">Dipendente</div>
                    </div>

                    {/* Months */}
                    {monthSpans.map((m, i) => {
                        // Calculate grid column start. Previous spans + 2 (because col 1 is names)
                        const prevSpans = monthSpans.slice(0, i).reduce((sum, curr) => sum + curr.span, 0);
                        const colStart = prevSpans + 2;
                        
                        return (
                            <div 
                                key={i} 
                                className="sticky top-0 z-20 bg-white border-b border-r border-l-2 border-l-blue-400 text-center font-semibold text-xs flex items-center justify-center capitalize"
                                style={{ 
                                    gridRow: 1, 
                                    gridColumn: `${colStart} / span ${m.span}`     
                                }}
                            >
                                {m.label}
                            </div>
                        );
                    })}

                    {/* --- ROW 2: DAY HEADERS --- */}
                    {dateColumns.map((date) => {
                        const isFirst = date.getDate() === 1;
                        const isWknd = isWeekend(date);
                        const isHol = globalHolidays.has(format(date, 'yyyy-MM-dd')); 
                        
                        return (
                            <div 
                                key={date.toISOString()} 
                                className={cn(
                                    "sticky z-20 border-b border-r flex flex-col items-center justify-center text-[9px] select-none",
                                    isHol || isWknd ? "bg-slate-100" : "bg-slate-50",
                                    isFirst ? "border-l-2 border-l-blue-500" : ""
                                )}
                                style={{ top: monthHeaderHeight, gridRow: 2 }}
                            >
                                <span className="font-bold">{format(date, 'd')}</span>
                                <span className="text-muted-foreground uppercase">{format(date, 'EEEEE', {locale: it})}</span>
                            </div>
                        );
                    })}

                    {/* --- DATA ROWS --- */}
                    {gridRows.map((row, rowIndex) => {
                        // Grid row index starts at 3 (after 2 header rows)
                        const gridRowIndex = rowIndex + 3;

                        if (row.type === 'department') {
                            return (
                                <React.Fragment key={`dept-${rowIndex}`}>
                                    <div 
                                        className="sticky left-0 z-10 bg-gray-100 border-b font-bold text-xs px-2 flex items-center text-gray-600 uppercase tracking-wider"
                                        style={{ gridRow: gridRowIndex, gridColumn: 1 }}
                                    >
                                        {row.label}
                                    </div>
                                    <div
                                        className="bg-slate-100 border-b"
                                        style={{ gridRow: gridRowIndex, gridColumn: `2 / span ${dateColumns.length}` }}
                                    />
                                </React.Fragment>
                            );
                        }

                        // User Row
                        return (
                            <React.Fragment key={row.user.id}>
                                {/* Sticky Name (Unchanged) */}
                                <div 
                                    className="sticky left-0 z-10 bg-white border-b border-r px-2 flex items-center text-xs font-medium truncate hover:bg-gray-50"
                                    style={{ gridRow: gridRowIndex }}
                                >
                                    {row.user.firstName} {row.user.lastName}
                                </div>

                                {/* Cells */}
                                {row.cells.map((cell: any, colIndex: number) => {
                                    // 1. Define the cell visuals and grid positioning
                                    // We create this as a variable so we can use it inside or outside the Tooltip
                                    const cellContent = (
                                        <div 
                                            className={cn(
                                                "border-r border-b flex items-center justify-center text-[9px] overflow-hidden whitespace-nowrap cursor-default w-full h-full", 
                                                cell.color
                                            )}
                                            style={{ 
                                                gridRow: gridRowIndex,
                                                gridColumn: colIndex + 2 
                                            }}
                                        >
                                            {/* Show label only if zoomed in enough or it fits */}
                                            {(cellWidth > 40 || cell.isPartial) && (
                                                <span className="text-white/90 px-1 truncate pointer-events-none">
                                                    {cell.label}
                                                </span>
                                            )}
                                        </div>
                                    );

                                    // 2. If the cell has a tooltip (it's not empty), wrap it in the Tooltip component
                                    if (cell.tooltip) {
                                        return (
                                            <Tooltip key={`${rowIndex}-${colIndex}`}>
                                                <TooltipTrigger asChild>
                                                    {cellContent}
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    <p className="font-semibold">{cell.tooltip}</p>
                                                </TooltipContent>
                                            </Tooltip>
                                        );
                                    }

                                    // 3. If it's an empty cell, return just the div (Better performance)
                                    return (
                                        <React.Fragment key={`${rowIndex}-${colIndex}`}>
                                            {cellContent}
                                        </React.Fragment>
                                    );
                                })}
                            </React.Fragment>
                        );
                    })}
                </div>
            )}
        </div>
    </div>
    </TooltipProvider>
  );
}
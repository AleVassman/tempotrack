
"use client";

import { useEffect, useState, useMemo } from "react";
import { collection, query, where, getDocs, doc, updateDoc, getDoc, onSnapshot, collectionGroup } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth, UserProfile } from "@/app/layout"; // Using UserProfile from layout
import { getDay, getWeek, format, eachDayOfInterval } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users, Clock, Check, X, Loader2, ArrowRightLeft, CalendarDays } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import TeamCalendar from "@/components/team-calendar";
import { CollapsibleNote } from "@/components/collapsible-note";
import { USER_ROLES, TIME_OFF_STATUS, MOVE_REQUEST_STATUS } from "@/lib/constants";

// --- INTERFACES ---

interface TimeOffRequest {
  id: string;
  userId: string;
  startDate: string;
  endDate: string;
  days: number;
  type: string;
  status: typeof TIME_OFF_STATUS[keyof typeof TIME_OFF_STATUS];
  userName?: string;
  startTime?: string | null;
  endTime?: string | null;
  department?: string;
  notes?: string;
  createdAt?: { seconds: number; nanoseconds: number; };
}

interface CompensatoryMoveRequest {
    id: string;
    status: typeof MOVE_REQUEST_STATUS[keyof typeof MOVE_REQUEST_STATUS];
    requestedDay: string;
    originalDay: string;
    minutes: number;
    userId: string;
    userName: string;
    requestedAt: { seconds: number; nanoseconds: number; };
}

type UnifiedRequest = (
    | { requestType: 'timeOff'; data: TimeOffRequest }
    | { requestType: 'compensatoryMove'; data: CompensatoryMoveRequest }
);

interface Holiday {
    date: string;
    name: string;
    departments?: string[];
    isPartial?: boolean;
    startTime?: string | null;
    endTime?: string | null;
}

// --- HELPER CONSTANT ---
const dayMapping: { [key: number]: string } = { 0: 'DOM', 1: 'LUN', 2: 'MAR', 3: 'MER', 4: 'GIO', 5: 'VEN', 6: 'SAB' };

export default function DashboardPage() {
  // --- CORE HOOKS ---
  const { user, userProfile, loading: authLoading } = useAuth();
  const { toast } = useToast();

  // --- STATE MANAGEMENT ---
  
  // Raw data fetched from Firestore listeners
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [pendingTimeOff, setPendingTimeOff] = useState<TimeOffRequest[]>([]);
  const [pendingMoveRequests, setPendingMoveRequests] = useState<CompensatoryMoveRequest[]>([]);
  const [approvedRequests, setApprovedRequests] = useState<TimeOffRequest[]>([]);
  const [approvedMoves, setApprovedMoves] = useState<CompensatoryMoveRequest[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  
  // UI state
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [updatingTimeOffId, setUpdatingTimeOffId] = useState<string | null>(null);
  const [updatingMoveRequestId, setUpdatingMoveRequestId] = useState<string | null>(null);

  const isHr = userProfile?.role === USER_ROLES.HR;
  const isAdmin = userProfile?.role === USER_ROLES.ADMIN;
  const isSuperUser = isHr || isAdmin;
  
  const pageLoading = authLoading || (isSuperUser && allUsers.length === 0);

  // --- DATA FETCHING ---

  useEffect(() => {
    // Only run listeners if the user is authenticated
    if (!authLoading && user) {
        setLoadingRequests(true);

        // --- SETUP ALL LISTENERS INDEPENDENTLY ---

        // 1. Listener for all ACTIVE user profiles
        const usersSub = onSnapshot(query(collection(db, "users"), where("status", "==", "active")), (snap) => {
    const usersData = snap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
    } as UserProfile));
    setAllUsers(usersData);
});

        // 2. Listener for all approved time-off requests
        const approvedTimeOffSub = onSnapshot(query(collection(db, "timeOffRequests"), where("status", "==", TIME_OFF_STATUS.APPROVED)), (snap) => {
            setApprovedRequests(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as TimeOffRequest)));
        });

        // 3. Listener for all approved compensatory move requests
        const approvedMovesSub = onSnapshot(query(collectionGroup(db, 'compensatoryMoveRequests'), where('status', '==', 'approved')), (snap) => {
            setApprovedMoves(snap.docs.map(doc => doc.data() as CompensatoryMoveRequest));
        });

        // 4. Listener for holidays
        const holidaysSub = onSnapshot(query(collection(db, "holidays")), (snap) => {
            let allHolidays: Holiday[] = [];
            snap.forEach(doc => { allHolidays = [...allHolidays, ...(doc.data().dates as Holiday[])]; });
            setHolidays(allHolidays);
        });

        // 5. Conditional listeners for PENDING requests (only for super users)
        let pendingTimeOffSub: (() => void) | null = null;
        let pendingMovesSub: (() => void) | null = null;

        if (isSuperUser) {
            // This complex logic is isolated and only runs for authorized users
            let managedUserIds: string[] = [];
            if (isHr) {
                 const pendingTORquery = query(collection(db, "timeOffRequests"), where("status", "==", TIME_OFF_STATUS.PENDING));
                 pendingTimeOffSub = onSnapshot(pendingTORquery, (snap) => {
                    setPendingTimeOff(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as TimeOffRequest)));
                    setLoadingRequests(false);
                 });
                 const pendingCMRquery = query(collectionGroup(db, 'compensatoryMoveRequests'), where('status', '==', MOVE_REQUEST_STATUS.PENDING));
                 pendingMovesSub = onSnapshot(pendingCMRquery, snap => { setPendingMoveRequests(snap.docs.map(doc => doc.data() as CompensatoryMoveRequest));
                 });

            } else if (isAdmin && userProfile) {
                managedUserIds.push(user.uid);
                const managedDepts = userProfile.managedDepartments || [];
                if (managedDepts.length > 0) {
                    getDocs(query(collection(db, "users"), where("department", "in", managedDepts)))
                        .then(snap => {
                            snap.forEach(doc => { if (!managedUserIds.includes(doc.id)) managedUserIds.push(doc.id) });
                            const finalUserIds = managedUserIds.length > 0 ? managedUserIds : ['placeholder'];
                            const pendingTORquery = query(collection(db, "timeOffRequests"), where("status", "==", TIME_OFF_STATUS.PENDING), where("userId", "in", finalUserIds));
                            pendingTimeOffSub = onSnapshot(pendingTORquery, snap => setPendingTimeOff(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as TimeOffRequest))));
                            setLoadingRequests(false);
                        });
                } else {
                     const pendingTORquery = query(collection(db, "timeOffRequests"), where("status", "==", TIME_OFF_STATUS.PENDING), where("userId", "in", managedUserIds));
                     pendingTimeOffSub = onSnapshot(pendingTORquery, snap => setPendingTimeOff(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as TimeOffRequest))));
                     setLoadingRequests(false);
                }
            }
        } else {
            setLoadingRequests(false); // Not a super user, so no pending requests to load
        }

        // Cleanup function to detach all listeners when the component unmounts
        return () => {
            usersSub();
            approvedTimeOffSub();
            approvedMovesSub();
            holidaysSub();
            if (pendingTimeOffSub) pendingTimeOffSub();
            if (pendingMovesSub) pendingMovesSub();
        };
    }
  }, [authLoading, user, isSuperUser, isHr, isAdmin, userProfile]);

  // --- DATA PROCESSING ---

  const compensatoryDayData = useMemo(() => {
    const compDayMap = new Map<string, { userName: string; type: string; timeSpan?: string }[]>();
    if (allUsers.length === 0) return compDayMap;

    const currentYear = new Date().getFullYear();
    const dateInterval = eachDayOfInterval({ 
        start: new Date(currentYear - 1, 0, 1), 
        end: new Date(currentYear + 1, 11, 31) 
    });
    
    const movesMap = new Map<string, CompensatoryMoveRequest>();
    approvedMoves.forEach(move => movesMap.set(`${move.userId}_${move.id}`, move));

    allUsers.forEach(u => {
      if (!u.id) return;
      const userName = `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || 'Sconosciuto';
      
      dateInterval.forEach(day => {
        const formattedDate = format(day, "yyyy-MM-dd");
        
        // --- LOGICA FESTIVITÀ ---
        // Trova se in questo giorno c'è una festa che riguarda l'utente
        const holiday = holidays.find(h => h.date === formattedDate);
        const depts = holiday?.departments || [];
        const isUserHoliday = holiday && (depts.length === 0 || depts.includes(u.department || 'Nessuno'));

        // Se è una festa INTERA per l'utente, nascondiamo il recupero
        if (isUserHoliday && !holiday.isPartial) return;

        const dayAbbr = dayMapping[getDay(day)];
        const weekId = `${format(day, 'yyyy')}-W${getWeek(day, { weekStartsOn: 1 })}`;
        const moveForThisWeek = movesMap.get(`${u.id}_${weekId}`);
        
        let isCompensatoryDay = false;
        let timeSpan = "";

        if (moveForThisWeek) {
          if (moveForThisWeek.requestedDay === dayAbbr) {
            isCompensatoryDay = true;
            // Usa gli orari del profilo come riferimento per lo spostamento
            if (u.weeklyCompensatoryDay?.startTime && u.weeklyCompensatoryDay?.endTime) {
                timeSpan = `${u.weeklyCompensatoryDay.startTime}-${u.weeklyCompensatoryDay.endTime}`;
            }
          }
        } else if (u.weeklyCompensatoryDay?.day === dayAbbr) {
          isCompensatoryDay = true;
          if (u.weeklyCompensatoryDay.startTime && u.weeklyCompensatoryDay.endTime) {
            timeSpan = `${u.weeklyCompensatoryDay.startTime}-${u.weeklyCompensatoryDay.endTime}`;
          }
        }

        if (isCompensatoryDay) {
          const existing = compDayMap.get(formattedDate) || [];
          compDayMap.set(formattedDate, [...existing, { 
            userName, 
            type: "Recupero",
            timeSpan: timeSpan || undefined 
          }]);
        }
      });
    });
    return compDayMap;
  }, [allUsers, approvedMoves, holidays]);

  // Memoized list of pending requests to display
  const mergedPendingRequests = useMemo((): UnifiedRequest[] => {
    const unifiedTimeOff: UnifiedRequest[] = pendingTimeOff.map(data => ({ requestType: 'timeOff', data }));
    const unifiedMoveRequests: UnifiedRequest[] = pendingMoveRequests.map(data => ({ requestType: 'compensatoryMove', data }));
    const allRequests = [...unifiedTimeOff, ...unifiedMoveRequests];
    allRequests.sort((a, b) => {
        const timeA = a.requestType === 'timeOff' ? a.data.createdAt?.seconds : a.data.requestedAt?.seconds;
        const timeB = b.requestType === 'timeOff' ? b.data.createdAt?.seconds : b.data.requestedAt?.seconds;
        return (timeB || 0) - (timeA || 0);
    });
    return allRequests;
  }, [pendingTimeOff, pendingMoveRequests]);


  // --- HANDLERS ---
  const handleTimeOffUpdate = async (id: string, newStatus: 'Approvato' | 'Rifiutato') => {
    setUpdatingTimeOffId(id);
    try {
        const requestDocRef = doc(db, "timeOffRequests", id);
        await updateDoc(requestDocRef, { status: newStatus });
        // The onSnapshot listener will automatically update the UI.
        toast({ title: "Richiesta Aggiornata", description: `La richiesta è stata ${newStatus.toLowerCase()}.` });
    } catch (error) {
        console.error("Error updating request: ", error);
        toast({ variant: "destructive", title: "Errore", description: "Impossibile aggiornare la richiesta." });
    } finally {
        setUpdatingTimeOffId(null);
    }
  };

  const handleCompensatoryMoveUpdate = async (userId: string, weekId: string, newStatus: 'approved' | 'rejected') => {
    setUpdatingMoveRequestId(weekId);
    try {
        const requestDocRef = doc(db, `users/${userId}/compensatoryMoveRequests`, weekId);
        await updateDoc(requestDocRef, { status: newStatus });
        toast({ title: "Richiesta Aggiornata", description: `La richiesta di spostamento è stata ${newStatus === 'approved' ? 'approvata' : 'rifiutata'}.` });
    } catch (error) {
        console.error("Error updating move request:", error);
        toast({ variant: "destructive", title: "Errore", description: "Impossibile aggiornare la richiesta." });
    } finally {
        setUpdatingMoveRequestId(null);
    }
  };

  // --- RENDER LOGIC AND JSX ---
  const kpiData = [
    { title: "Dipendenti Totali", value: allUsers.length, icon: <Users className="h-6 w-6 text-muted-foreground" />, roles: [USER_ROLES.HR, USER_ROLES.ADMIN] },
    { title: "Richieste in Sospeso", value: mergedPendingRequests.length, icon: <Clock className="h-6 w-6 text-muted-foreground" />, roles: [USER_ROLES.ADMIN, USER_ROLES.HR] },
  ];
  const userHasAccess = (kpiRoles: string[]) => userProfile?.role && kpiRoles.includes(userProfile.role);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-headline text-3xl font-semibold">Dashboard</h1>
        <p className="text-muted-foreground">Bentornato, ecco un riepilogo della tua organizzazione.</p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {kpiData.filter(kpi => userHasAccess(kpi.roles)).map((kpi) => (
          <Card key={kpi.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{kpi.title}</CardTitle>
              {kpi.icon}
            </CardHeader>
            <CardContent>
              {authLoading ? <Skeleton className="h-7 w-12" /> : (<div className="text-2xl font-bold">{kpi.value !== null ? kpi.value : '--'}</div>)}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Team Calendar */}
      <div className="grid gap-8 md:grid-cols-1">
          <Card>
              <CardHeader>
                  <CardTitle>Calendario Assenze Team</CardTitle>
                  <CardDescription>Visualizza le assenze approvate, i recuperi e i giorni festivi.</CardDescription>
              </CardHeader>
              <CardContent>
                  <TeamCalendar 
                      requests={approvedRequests} 
                      holidays={holidays} 
                      compensatoryDays={compensatoryDayData}
                      allUsers={allUsers}
                      loading={pageLoading}
                  />
              </CardContent>
          </Card>
      </div>
      
      {/* Pending Requests */}
      {isSuperUser && (
        <div className="grid grid-cols-1 gap-8">
            <Card>
                <CardHeader>
                    <CardTitle>Richieste in Sospeso</CardTitle>
                    <CardDescription>Rivedi e approva le richieste dei dipendenti.</CardDescription>
                </CardHeader>
                <CardContent>
                    {loadingRequests ? (
                        <div className="space-y-4">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}</div>
                    ) : mergedPendingRequests.length === 0 ? (
                        <p className="text-center text-muted-foreground py-8">Nessuna richiesta in sospeso.</p>
                    ) : (
                        <div className="space-y-4">
                            {mergedPendingRequests.map((req) => {
                                if (req.requestType === 'timeOff') {
                                    const isUpdating = updatingTimeOffId === req.data.id;
                                    const requestData = req.data;
                                    return (
                                        <div key={`timeoff-${requestData.id}`} className="p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors">
                                            <div className="grid grid-cols-1 gap-y-2">
                                                <div className="flex items-start justify-between gap-4">
                                                    <div className="flex items-start gap-4 min-w-0">
                                                        <CalendarDays className="h-6 w-6 text-muted-foreground flex-shrink-0 mt-1" />
                                                        <div className="flex-1 min-w-0">
                                                            <div className="font-semibold truncate">{requestData.userName}</div>
                                                            {requestData.days === 0 && requestData.startTime && requestData.endTime ? (
                                                                <>
                                                                    <div className="text-sm text-muted-foreground truncate">{requestData.type} (Orario)</div>
                                                                    <div className="text-xs text-muted-foreground truncate">{requestData.startDate}: Dalle {requestData.startTime} alle {requestData.endTime}</div>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <div className="text-sm text-muted-foreground truncate">{requestData.type} ({requestData.days} giorni)</div>
                                                                    <div className="text-xs text-muted-foreground truncate">{requestData.startDate} - {requestData.endDate}</div>
                                                                </>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-2 flex-shrink-0">
                                                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => handleTimeOffUpdate(requestData.id, TIME_OFF_STATUS.APPROVED)} disabled={isUpdating}>
                                                            {isUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                                                        </Button>
                                                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => handleTimeOffUpdate(requestData.id, TIME_OFF_STATUS.REJECTED)} disabled={isUpdating}>
                                                            {isUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                                                        </Button>
                                                    </div>
                                                </div>
                                                {requestData.notes && (
                                                    <div className="pl-10">
                                                        <CollapsibleNote note={requestData.notes} maxLength={80} className="text-sm text-muted-foreground italic"/>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                }
                                if (req.requestType === 'compensatoryMove') {
                                    const isUpdating = updatingMoveRequestId === req.data.id;
                                    const requestData = req.data;
                                    return (
                                        <div key={`move-${requestData.userId}-${requestData.id}`} className="flex items-center justify-between p-3 rounded-lg border bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors">
                                           <div className="flex items-center gap-4 flex-1 min-w-0">
                                                <ArrowRightLeft className="h-6 w-6 text-blue-600 flex-shrink-0" />
                                                <div className="flex-1 min-w-0">
                                                    <div className="font-semibold truncate">{requestData.userName}</div>
                                                    <div className="text-sm text-blue-800 dark:text-blue-300 truncate">Spostamento Recupero ({requestData.id})</div>
                                                    <div className="text-xs text-muted-foreground truncate">{requestData.originalDay} &rarr; {requestData.requestedDay}</div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => handleCompensatoryMoveUpdate(requestData.userId, requestData.id, MOVE_REQUEST_STATUS.APPROVED)} disabled={isUpdating}>
                                                    {isUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                                                </Button>
                                                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => handleCompensatoryMoveUpdate(requestData.userId, requestData.id, MOVE_REQUEST_STATUS.REJECTED)} disabled={isUpdating}>
                                                    {isUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                                                </Button>
                                            </div>
                                        </div>
                                    );
                                }
                                return null;
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
      )}
    </div>
  );
}
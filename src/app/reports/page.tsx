
"use client";

import { useState, useEffect, useMemo } from "react";
import { collection, query, where, getDocs, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth, UserProfile } from "@/app/layout";
import { TIME_OFF_STATUS, LEAVE_TYPES, LEAVE_TYPE_COLORS } from "@/lib/constants";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import { AlertTriangle, Calendar as CalendarIcon } from "lucide-react";
import { format, startOfYear, endOfYear, startOfMonth, endOfMonth, eachDayOfInterval, parseISO } from "date-fns";
import { it } from "date-fns/locale";
import { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";

// --- TYPE DEFINITIONS ---

// For the individual trend line charts
interface TrendDataPoint {
    month: string;
    "Giorni": number; // Simplified key for the small chart
}

// For the main stacked bar chart data. Includes trend data.
interface AbsenceSummary {
  userId: string;
  userName: string;
  department: string;
  totalDays: number;
  trendData: TrendDataPoint[];
  [leaveType: string]: number | string | TrendDataPoint[];
}

// For the list of users we manage
interface ManagedUser extends UserProfile {
  id: string;
  name:string;
}

export default function ReportsPage() {
  // --- Authentication & Authorization ---
  const { user, userProfile, loading: authLoading } = useAuth();
  const isHr = userProfile?.role === 'hr';
  const isAdmin = userProfile?.role === 'admin';
  const isSuperUser = isHr || isAdmin;

  // --- Data State ---
  // Holds all data for the stacked bar chart and individual trends
  const [summaries, setSummaries] = useState<AbsenceSummary[]>([]);

  // --- UI State ---
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // --- Filter State ---
  type FilterType = 'year' | 'month' | 'timespan';
  const [filterType, setFilterType] = useState<FilterType>('year');
  
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), "yyyy-MM"));

  // State for the custom date range picker, defaulting to the current year
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: startOfYear(new Date()),
    to: endOfYear(new Date()),
  });

  useEffect(() => {
    if (authLoading || !isSuperUser) {
      setLoading(false);
      return;
    }

    const fetchAbsenceData = async () => {
      setLoading(true);
      setError(null);
      setSummaries([]);

      try {
        // 1. Determine date range from filters
        let startDateObj: Date, endDateObj: Date;
        if (filterType === 'year') {
          const year = parseInt(selectedYear);
          startDateObj = startOfYear(new Date(year, 0, 1));
          endDateObj = endOfYear(new Date(year, 0, 1));
        } else if (filterType === 'month') {
          const monthDate = parseISO(selectedMonth + "-01");
          startDateObj = startOfMonth(monthDate);
          endDateObj = endOfMonth(monthDate);
        } else { // 'timespan'
          if (!dateRange?.from || !dateRange?.to) {
            setLoading(false);
            return;
          }
          startDateObj = dateRange.from;
          endDateObj = dateRange.to;
        }
        const startDate = format(startDateObj, "yyyy-MM-dd");
        const endDate = format(endDateObj, "yyyy-MM-dd");

        // 2. Get managed users and create a lookup map for easy access
        let managedUsers: ManagedUser[] = [];
        if (isHr) {
          const usersSnapshot = await getDocs(query(collection(db, "users"), where("status", "==", "active"), orderBy("lastName")));
          managedUsers = usersSnapshot.docs.map(doc => ({ id: doc.id, name: `${doc.data().firstName || ''} ${doc.data().lastName || ''}`.trim() || doc.data().email, ...doc.data() } as ManagedUser));
        } else if (isAdmin && userProfile.managedDepartments && userProfile.managedDepartments.length > 0) {
          const usersSnapshot = await getDocs(query(collection(db, "users"), where("department", "in", userProfile.managedDepartments), where("status", "==", "active"), orderBy("lastName")));
          managedUsers = usersSnapshot.docs.map(doc => ({ id: doc.id, name: `${doc.data().firstName || ''} ${doc.data().lastName || ''}`.trim() || doc.data().email, ...doc.data() } as ManagedUser));
        }

        const userMap = new Map<string, ManagedUser>(managedUsers.map(u => [u.id, u]));

        if (managedUsers.length === 0) {
          setLoading(false);
          return;
        }
        const managedUserIds = managedUsers.map(u => u.id);

        // 3. Fetch from both 'timeOffRequests' and 'archive_timeOffRequests' collections in batches
        const allRequests: any[] = [];
        const fetchFromCollection = async (collectionName: string) => {
          const promises = [];
          for (let i = 0; i < managedUserIds.length; i += 30) {
            const chunk = managedUserIds.slice(i, i + 30);
            const requestsQuery = query(
              collection(db, collectionName),
              where("userId", "in", chunk),
              where("status", "==", TIME_OFF_STATUS.APPROVED),
              where("startDate", "<=", endDate)
            );
            promises.push(getDocs(requestsQuery));
          }
          const querySnapshots = await Promise.all(promises);
          querySnapshots.forEach(s => s.forEach(doc => allRequests.push(doc.data())));
        };
        
        await Promise.all([
          fetchFromCollection("timeOffRequests"),
          fetchFromCollection("archive_timeOffRequests")
        ]);
        
        const filteredRequests = allRequests.filter(req => req.endDate >= startDate);

        // 4. Process data for Summaries, with dynamic workday calculation
        const summaryMap: { [userId: string]: AbsenceSummary } = {};
        managedUsers.forEach(u => {
          summaryMap[u.id] = { userId: u.id, userName: u.name, department: u.department || 'N/A', totalDays: 0, trendData: [] };
          LEAVE_TYPES.forEach(lt => { summaryMap[u.id][lt.value] = 0; });
        });

        filteredRequests.forEach(req => {
            if (summaryMap[req.userId] && (req.days !== undefined)) {
                let daysToAdd = 0;

                if (req.days > 0) {
                    daysToAdd = req.days;
                } else if (req.days === 0 && req.startTime && req.endTime) {
                    try {
                        const userForRequest = userMap.get(req.userId);
                        if (!userForRequest || !userForRequest.workSchedule) {
                            throw new Error(`User ${req.userId} has no work schedule defined.`);
                        }

                        const requestDate = parseISO(req.startDate);
                        const dayOfWeekIndex = requestDate.getDay();
                        const dayAbbr = ['DOM', 'LUN', 'MAR', 'MER', 'GIO', 'VEN', 'SAB'][dayOfWeekIndex];

                        const scheduledDay = userForRequest.workSchedule.find(d => d.day === dayAbbr);
                        const scheduledHours = scheduledDay ? scheduledDay.hours : 8; // Fallback to 8

                        if (scheduledHours > 0) {
                            const start = parseISO(`1970-01-01T${req.startTime}:00`);
                            const end = parseISO(`1970-01-01T${req.endTime}:00`);
                            const permitHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
                            
                            daysToAdd = permitHours / scheduledHours;
                        }
                    } catch (e) {
                        console.error("Could not process partial day request:", e);
                        daysToAdd = 0;
                    }
                }

                if (daysToAdd > 0) {
                    summaryMap[req.userId].totalDays += daysToAdd;
                    if (summaryMap[req.userId][req.type] !== undefined) {
                        (summaryMap[req.userId][req.type] as number) += daysToAdd;
                    }
                }
            }
        });

        // 5. Process data for Individual Trend Line Charts, with dynamic workday calculation
        const userTrendMap: { [userId: string]: { [monthKey: string]: { total: number, date: Date } } } = {};
        filteredRequests.forEach(req => {
            const userId = req.userId;
            const userForRequest = userMap.get(userId);

            if (!userTrendMap[userId]) userTrendMap[userId] = {};
            
            const daysInRequest = eachDayOfInterval({ start: parseISO(req.startDate), end: parseISO(req.endDate) });
            daysInRequest.forEach(day => {
                if (day >= startDateObj && day <= endDateObj) {
                    let daysToAddThisDay = 0;
                    if (req.days > 0) {
                        daysToAddThisDay = 1;
                    } else if (req.days === 0 && req.startTime && req.endTime) {
                        try {
                            if (!userForRequest || !userForRequest.workSchedule) throw new Error("No schedule");
                            const dayOfWeekIndex = day.getDay();
                            const dayAbbr = ['DOM', 'LUN', 'MAR', 'MER', 'GIO', 'VEN', 'SAB'][dayOfWeekIndex];
                            const scheduledDay = userForRequest.workSchedule.find(d => d.day === dayAbbr);
                            const scheduledHours = scheduledDay ? scheduledDay.hours : 8;

                            if (scheduledHours > 0) {
                                const start = parseISO(`1970-01-01T${req.startTime}:00`);
                                const end = parseISO(`1970-01-01T${req.endTime}:00`);
                                const permitHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
                                daysToAddThisDay = permitHours / scheduledHours;
                            }
                        } catch (e) {
                            daysToAddThisDay = 0;
                        }
                    }

                    if (daysToAddThisDay > 0) {
                        const monthKey = format(day, "yyyy-MM");
                        if (!userTrendMap[userId][monthKey]) {
                            userTrendMap[userId][monthKey] = { total: 0, date: startOfMonth(day) };
                        }
                        userTrendMap[userId][monthKey].total += daysToAddThisDay;
                    }
                }
            });
        });
        
        // Attach trend data to each summary object
        Object.keys(summaryMap).forEach(userId => {
          const userTrends = userTrendMap[userId];
          const trendPoints = userTrends ? Object.values(userTrends)
            .sort((a, b) => a.date.getTime() - b.date.getTime())
            .map(data => ({
              month: format(data.date, 'MMM yy', { locale: it }),
              "Giorni": data.total,
            })) : [];
          summaryMap[userId].trendData = trendPoints;
        });

        // Sort final summaries by total days descending
        const finalSummaries = Object.values(summaryMap).sort((a, b) => b.totalDays - a.totalDays);
        setSummaries(finalSummaries);

      } catch (err: any) {
        console.error("Error fetching absence data:", err);
        setError(`Impossibile caricare i dati: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };

    fetchAbsenceData();
  }, [filterType, selectedYear, selectedMonth, dateRange, userProfile, authLoading, isSuperUser, isHr, isAdmin]);

  const yearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: 5 }, (_, i) => (currentYear - i).toString());
  }, []);

  const monthOptions = useMemo(() => {
    const months = [];
    const today = new Date();
    for (let i = 0; i < 24; i++) {
      const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
      months.push({
        value: format(date, "yyyy-MM"),
        label: format(date, "MMMM yyyy", { locale: it }),
      });
    }
    return months;
  }, []);

  const columns = useMemo(() => {
    const activeLeaveTypes = new Set<string>();
    summaries.forEach(summary => {
      LEAVE_TYPES.forEach(lt => {
        if ((summary[lt.value] as number) > 0) {
          activeLeaveTypes.add(lt.value);
        }
      });
    });
    return LEAVE_TYPES.filter(lt => activeLeaveTypes.has(lt.value)).map(lt => lt.value);
  }, [summaries]);


  // --- ACCESS DENIED RENDER ---
  if (!authLoading && !isSuperUser) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center">
        <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
        <h1 className="font-headline text-2xl font-semibold">Accesso Negato</h1>
        <p className="text-muted-foreground mt-2">Non hai i permessi per visualizzare questa pagina.</p>
      </div>
    );
  }

  // --- MAIN RENDER ---
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-headline text-3xl font-semibold">Report Assenze</h1>
        <p className="text-muted-foreground">Analisi visiva delle assenze dei dipendenti per tipo e andamento temporale.</p>
      </div>

      {/* --- FILTER CONTROLS CARD --- */}
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <CardTitle>Filtri Report</CardTitle>
            <CardDescription>Seleziona un periodo per visualizzare i dati.</CardDescription>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Select value={filterType} onValueChange={(value) => setFilterType(value as FilterType)}>
              <SelectTrigger className="w-full sm:w-[130px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="year">Anno</SelectItem>
                <SelectItem value="month">Mese</SelectItem>
                <SelectItem value="timespan">Periodo</SelectItem>
              </SelectContent>
            </Select>
            {filterType === 'year' && (
              <Select value={selectedYear} onValueChange={setSelectedYear}>
                <SelectTrigger className="w-full sm:w-[180px]"><SelectValue /></SelectTrigger>
                <SelectContent>{yearOptions.map(year => <SelectItem key={year} value={year}>{year}</SelectItem>)}</SelectContent>
              </Select>
            )}
            {filterType === 'month' && (
              <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                <SelectTrigger className="w-full sm:w-[180px]"><SelectValue /></SelectTrigger>
                <SelectContent>{monthOptions.map(month => <SelectItem key={month.value} value={month.value}>{month.label}</SelectItem>)}</SelectContent>
              </Select>
            )}
            {filterType === 'timespan' && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant={"outline"} className={cn("w-full sm:w-[300px] justify-start text-left font-normal", !dateRange && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateRange?.from ? (dateRange.to ? (<>{format(dateRange.from, "dd LLL, yy")} - {format(dateRange.to, "dd LLL, yy")}</>) : (format(dateRange.from, "dd LLL, yy"))) : (<span>Scegli un periodo</span>)}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar autoFocus mode="range" defaultMonth={dateRange?.from} selected={dateRange} onSelect={setDateRange} numberOfMonths={2}/>
                </PopoverContent>
              </Popover>
            )}
          </div>
        </CardHeader>
      </Card>

      {/* Show Skeleton/Error/Empty states */}
      {loading && <Skeleton className="h-96 w-full" />}
      {error && <p className="text-center text-destructive py-8">{error}</p>}
      {!loading && !error && summaries.length === 0 && (
        <p className="text-center text-muted-foreground py-8">Nessun dato di assenza trovato per il periodo selezionato.</p>
      )}

      {/* --- STACKED BAR CHART CARD --- */}
      {!loading && !error && summaries.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Riepilogo Assenze per Dipendente</CardTitle>
            <CardDescription>Totale giorni di assenza per ogni dipendente, suddivisi per tipo.</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={Math.max(400, summaries.filter(s => s.totalDays > 0).length * 50)}>
              <BarChart
                data={summaries.filter(s => s.totalDays > 0)}
                layout="vertical"
                margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" allowDecimals={false} />
                <YAxis type="category" dataKey="userName" width={150} tick={{ fontSize: 12 }} interval={0} />
                <Tooltip />
                <Legend />
                {columns.map((leaveType, index) => (
                  <Bar key={leaveType} dataKey={leaveType} stackId="a" fill={LEAVE_TYPE_COLORS[leaveType] || 'hsl(var(--muted-foreground))'} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* --- INDIVIDUAL TRENDS SECTION --- */}
      {!loading && !error && summaries.some(s => s.trendData.length > 1) && (
        <div className="space-y-6">
          <div className="text-center">
            <h2 className="font-headline text-2xl font-semibold">Andamento Individuale nel Tempo</h2>
            <p className="text-muted-foreground">Riepilogo mensile per dipendente nel periodo selezionato.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {summaries.filter(s => s.trendData.length > 1).map(summary => (
              <Card key={summary.userId}>
                <CardHeader>
                  <CardTitle className="text-lg">{summary.userName}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-40">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={summary.trendData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="month" fontSize={10} />
                        <YAxis fontSize={10} allowDecimals={false} width={30} tick={{ dx: -5 }} />
                        <Tooltip />
                        <Line type="monotone" dataKey="Giorni" stroke="hsl(var(--primary))" strokeWidth={2} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
"use client";

import { useEffect, useState } from "react";
import { collection, query, where, getDocs, doc, deleteDoc, orderBy, QueryConstraint, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth, UserProfile } from "@/app/layout";
import { CollapsibleNote } from "@/components/collapsible-note";
import TimeOffCalendar from "@/components/time-off-calendar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { CalendarCheck, CalendarX, Trash2, Clock, Calendar as CalendarIcon, Type } from "lucide-react";
import { format, parseISO, subMonths, addMonths } from "date-fns";
import { it } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/components/ui/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { USER_ROLES, TIME_OFF_STATUS } from "@/lib/constants";

type TimeOffStatus = typeof TIME_OFF_STATUS[keyof typeof TIME_OFF_STATUS];

interface TimeOffRequest {
  id: string;
  startDate: string;
  endDate:string;
  days: number;
  type: string;
  status: TimeOffStatus;
  userId: string;
  userName?: string;
  startTime?: string | null;
  endTime?: string | null;
  notes?: string;
}

interface UserForSelect {
  id: string;
  name: string;
}

// Generate last 12 and next 12 months for the filter
const getMonthOptions = () => {
    const today = new Date();
    const pastMonths = Array.from({ length: 12 }, (_, i) => subMonths(today, i)).reverse();
    const futureMonths = Array.from({ length: 12 }, (_, i) => addMonths(today, i + 1));
    
    const allMonths = [...pastMonths, ...futureMonths];

    return allMonths.map(d => ({
        value: format(d, "yyyy-MM"),
        label: format(d, "MMMM yyyy", { locale: it }),
    }));
};
const monthOptions = getMonthOptions();


function HistorySkeleton() {
    return (
        <div className="space-y-4">
             {[...Array(3)].map((_, i) => (
                 <Card key={i}>
                    <CardContent className="p-4 space-y-3">
                         <Skeleton className="h-5 w-3/4" />
                         <Skeleton className="h-4 w-1/2" />
                         <Skeleton className="h-4 w-1/3" />
                         <Skeleton className="h-8 w-full" />
                    </CardContent>
                 </Card>
             ))}
        </div>
    );
}

export default function TimeOffPage() {
    const { user, userProfile, loading: authLoading } = useAuth();
    const { toast } = useToast();
    const [history, setHistory] = useState<TimeOffRequest[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(true);
    const [allUsers, setAllUsers] = useState<UserForSelect[]>([]);
    const [selectedUserId, setSelectedUserId] = useState<string>("");
    const [selectedMonth, setSelectedMonth] = useState(format(new Date(), "yyyy-MM"));

    const isHr = userProfile?.role === USER_ROLES.HR;
    const isAdmin = userProfile?.role === USER_ROLES.ADMIN;
    const isSuperUser = isHr || isAdmin;

    // Real-time updates for users
    useEffect(() => {
        let usersUnsub: (() => void) | null = null;
        if (isHr) {
            const usersQuery = query(collection(db, "users"), where("status", "==", "active"), orderBy("lastName"));
            usersUnsub = onSnapshot(usersQuery, (usersSnapshot) => {
            const usersList = usersSnapshot.docs.map(doc => {
                const data = doc.data();
                const name = `${data.firstName || ''} ${data.lastName || ''}`.trim() || data.email;
                return { id: doc.id, name };
            });
            setAllUsers(usersList);
            });
        } else if (isAdmin && userProfile?.managedDepartments && userProfile.managedDepartments.length > 0) {
            const usersQuery = query(collection(db, "users"), where("department", "in", userProfile.managedDepartments), where("status", "==", "active"), orderBy("lastName"));
            usersUnsub = onSnapshot(usersQuery, (usersSnapshot) => {
            const usersList = usersSnapshot.docs.map(doc => {
                const data = doc.data();
                const name = `${data.firstName || ''} ${data.lastName || ''}`.trim() || data.email;
                return { id: doc.id, name };
            });
            
            if (user && !usersList.some(u => u.id === user.uid)) {
                const self: UserForSelect = {
                id: user.uid,
                name: `${userProfile.firstName || ''} ${userProfile.lastName || ''}`.trim() || user.email || 'Me Stesso'
                };
                usersList.unshift(self);
            }
            
            setAllUsers(usersList);
            });
        } else {
            if (user && userProfile) {
            setAllUsers([{
                id: user.uid,
                name: `${userProfile.firstName || ''} ${userProfile.lastName || ''}`.trim() || user.email || 'Me Stesso'
            }]);
            }
        }
        return () => {
            if (usersUnsub) usersUnsub();
        };
    }, [userProfile, authLoading, isHr, isAdmin, user]);

    // Real-time updates for requests
    useEffect(() => {
      let requestsUnsub: (() => void) | null = null;
      if (!user || !userProfile) {
        setLoadingHistory(false);
        return;
      }
      // This check is for HR/Admin before their user lists are populated
      if ((isHr || isAdmin) && allUsers.length === 0) {
        // We don't set loading to true here, as it might be a valid state (admin with no team)
        return;
      }
      setLoadingHistory(true);

      let filterConstraints: QueryConstraint[] = [];
      const orderConstraints = [orderBy("startDate", "desc")];
      
      if (isHr) {
        if (selectedUserId !== "all") {
          filterConstraints.push(where("userId", "==", selectedUserId));
        }
      } else if (isAdmin) {
        const managedIds = allUsers.map(u => u.id);

        // If an admin has no managed users (their list only contains themselves, or is empty),
        // and they select "Tutti i dipendenti", we must prevent an empty 'in' query.
        // In this case, we can just query for their own requests.
        if (selectedUserId === "all") {
            if (managedIds.length > 0) {
               filterConstraints.push(where("userId", "in", managedIds));
            } else {
                // FALLBACK: If managedIds is empty, do not run a query that will crash.
                // It's better to show nothing than to crash the page.
                setHistory([]);
                setLoadingHistory(false);
                return; // Exit the effect early.
            }
        } else {
            filterConstraints.push(where("userId", "==", selectedUserId));
        }
      } else { // Regular user
        filterConstraints.push(where("userId", "==", user.uid));
      }
      
      const q = query(collection(db, "timeOffRequests"), ...filterConstraints, ...orderConstraints);

      requestsUnsub = onSnapshot(q, async (querySnapshot) => {
        const userIds = Array.from(new Set(querySnapshot.docs.map(d => d.data().userId)));
        
        let userMap = new Map<string, string>();
        if (userIds.length > 0) {
            const usersQuery = query(collection(db, "users"), where("__name__", "in", userIds));
            const usersSnapshot = await getDocs(usersQuery);
            usersSnapshot.forEach(doc => {
                 const data = doc.data();
                 const name = `${data.firstName || ''} ${data.lastName || ''}`.trim() || data.email;
                 userMap.set(doc.id, name);
            });
        }

        const requests = querySnapshot.docs.map(doc => {
          const data = doc.data();
          const userName = userMap.get(data.userId) || data.userEmail || data.userId;
          return { id: doc.id, ...data, userName } as TimeOffRequest;
        });
        setHistory(requests);
        setLoadingHistory(false);
      });

      return () => {
        if (requestsUnsub) requestsUnsub();
      };
    }, [user, userProfile, authLoading, selectedUserId, allUsers, isHr, isAdmin]);
    
    useEffect(() => {
        if (!authLoading && user && userProfile) {
            if (isHr || isAdmin) {
                setSelectedUserId(user.uid);
            } else {
                setSelectedUserId(user.uid);
            }
        }
    }, [authLoading, user, userProfile, isHr, isAdmin]);

    const handleDelete = async (requestId: string) => {
        try {
            await deleteDoc(doc(db, "timeOffRequests", requestId));
            toast({
                title: "Richiesta Eliminata",
                description: "La richiesta di permesso è stata cancellata con successo.",
            });
        } catch (error) {
            console.error("Error deleting request: ", error);
            toast({
                variant: "destructive",
                title: "Errore",
                description: "Impossibile cancellare la richiesta.",
            });
        }
    };

    // Helper function to check delete permissions
    const canDeleteRequest = (request: TimeOffRequest): boolean => {
        if (!user || !userProfile) return false;

        // HR can delete any request
        if (isHr) {
            return true;
        }

        // Admin can delete their own requests or requests from their team
        if (isAdmin) {
            // `allUsers` for an admin contains their team members + themselves
            const isOwnRequest = request.userId === user.uid;
            const isManagedUserRequest = allUsers.some(u => u.id === request.userId);
            return isOwnRequest || isManagedUserRequest;
        }

        // Regular users can only delete their own PENDING requests
        // return request.userId === user.uid && request.status === 'In Sospeso';
        return request.userId === user.uid && request.status === TIME_OFF_STATUS.PENDING;
    };
    
    const isLoading = loadingHistory || authLoading;

    const filteredHistory = history.filter(item => {
        const itemMonth = format(parseISO(item.startDate), "yyyy-MM");
        return itemMonth === selectedMonth;
    });
    
    const getStatusBadge = (status: TimeOffRequest['status']) => {

      const isApproved = status === TIME_OFF_STATUS.APPROVED;
      const isRejected = status === TIME_OFF_STATUS.REJECTED;
      
      return (
        <Badge 
          variant={isApproved ? 'default' : isRejected ? 'destructive' : 'secondary'} 
          className={cn(isApproved && 'bg-green-500 hover:bg-green-600 text-white')}
        >
          {isApproved && <CalendarCheck className="h-3 w-3 mr-1"/>}
          {isRejected && <CalendarX className="h-3 w-3 mr-1"/>}
          {status === TIME_OFF_STATUS.PENDING && <Clock className="h-3 w-3 mr-1"/>}
          {status}
        </Badge>
      );
    }
    
    if (authLoading) {
        return <div className="flex flex-col gap-8"><HistorySkeleton /></div>;
    }
    if (!user || !userProfile) {
        return <div className="flex flex-col gap-8"><p className="text-center text-muted-foreground py-8">Devi essere autenticato per visualizzare questa pagina.</p></div>;
    }

    return (
        <div className="flex flex-col gap-8">
             <div>
                <h1 className="font-headline text-3xl font-semibold">Permessi</h1>
                <p className="text-muted-foreground">Gestisci le tue richieste di permesso e visualizza il tuo saldo.</p>
            </div>
            
            <div className="grid grid-cols-1 gap-8">
                <TimeOffCalendar onNewRequest={() => {}} />
            
                <Card>
                    <CardHeader>
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                            <div>
                                <CardTitle>Cronologia Richieste</CardTitle>
                                <CardDescription>
                                    {isSuperUser ? 'Visualizza tutte le richieste di permesso.' : 'Le tue passate richieste di permesso.'}
                                </CardDescription>
                            </div>
                            <div className="flex flex-col sm:flex-row gap-2">
                                <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                                    <SelectTrigger className="w-full sm:w-[180px]">
                                        <SelectValue placeholder="Seleziona un mese" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {monthOptions.map(month => (
                                            <SelectItem key={month.value} value={month.value}>{month.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                {isSuperUser && (
                                    <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                                        <SelectTrigger className="w-full sm:w-[250px]">
                                            <SelectValue placeholder="Filtra per dipendente" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">Tutti i dipendenti</SelectItem>
                                            {allUsers.map(u => (
                                                <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {isLoading ? <HistorySkeleton /> : (
                         <>

{/* CORRECTED MOBILE VIEW */}
<div className="sm:hidden">
    {filteredHistory.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">Nessuna richiesta trovata per questo mese.</p>
    ) : (
        <div className="space-y-4">
            {filteredHistory.map((item) => (
                <Card key={item.id}>
                    <CardContent className="p-4 flex flex-col gap-3">
                        <div className="flex justify-between items-start">
                            <div>
                                {isSuperUser && <h3 className="font-semibold text-sm">{item.userName}</h3>}
                                {getStatusBadge(item.status)}
                            </div>
                            {canDeleteRequest(item) && (
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Sei sicuro?</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                Questa azione è irreversibile e eliminerà la richiesta di permesso.
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Annulla</AlertDialogCancel>
                                            <AlertDialogAction onClick={() => handleDelete(item.id)}>Elimina</AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            )}
                        </div>
                        <div className="text-sm text-muted-foreground space-y-2 border-t pt-3 mt-2">
                            <div className="flex items-center gap-2">
                                <Type className="h-4 w-4" />
                                <span>{item.type}</span>
                            </div>
                            {item.days === 0 && item.startTime && item.endTime ? (
                                <div className="flex items-center gap-2">
                                    <Clock className="h-4 w-4" />
                                    <span>{format(parseISO(item.startDate), 'd MMM, yyyy', { locale: it })} (dalle {item.startTime} alle {item.endTime})</span>
                                </div>
                            ) : (
                                <div className="flex items-center gap-2">
                                    <CalendarIcon className="h-4 w-4" />
                                    <span>{format(parseISO(item.startDate), 'd MMM', { locale: it })} - {format(parseISO(item.endDate), 'd MMM, yyyy', { locale: it })} ({item.days} giorni)</span>
                                </div>
                            )}
                            {/* --- THIS IS THE FIX: "&& isSuperUser" is REMOVED --- */}
{item.notes && (
    <CollapsibleNote note={item.notes} />
)}
                        </div>
                    </CardContent>
                </Card>
            ))}
        </div>
    )}
</div>
                         
{/* DESKTOP VIEW */}
<div className="hidden sm:block">
    <Table>
        <TableHeader>
            <TableRow>
                {isSuperUser && <TableHead>Dipendente</TableHead>}
                <TableHead>Periodo</TableHead>
                <TableHead>Tipo</TableHead>
                {isSuperUser && <TableHead>Note</TableHead>}
                <TableHead>Stato</TableHead>
                <TableHead className="text-right">Azioni</TableHead>
            </TableRow>
        </TableHeader>
        <TableBody>
            {filteredHistory.length === 0 ? (
                <TableRow>
                    <TableCell colSpan={isSuperUser ? 6 : 4} className="h-24 text-center">Nessuna richiesta trovata.</TableCell>
                </TableRow>
            ) : (
                filteredHistory.map((item) => (
                    <TableRow key={item.id}>
                        {isSuperUser && <TableCell className="font-medium text-xs">{item.userName}</TableCell>}
                        <TableCell>
                            {/* Logic for displaying period and notes */}
                            {item.days === 0 && item.startTime && item.endTime ? (
                                <>
                                    <div className="font-medium">{format(parseISO(item.startDate), 'd MMM, yyyy', { locale: it })}</div>
                                    <div className="text-sm text-muted-foreground">Dalle {item.startTime} alle {item.endTime}</div>
                                </>
                            ) : (
                                <>
                                    <div className="font-medium">{format(parseISO(item.startDate), 'd MMM, yyyy', { locale: it })} - {format(parseISO(item.endDate), 'd MMM, yyyy', { locale: it })}</div>
                                    <div className="text-sm text-muted-foreground">{item.days} giorni</div>
                                </>
                            )}
                            {/* Conditionally show notes for standard users below the period */}
{!isSuperUser && item.notes && (
    <CollapsibleNote note={item.notes} className="pt-2" />
)}
                        </TableCell>
                        <TableCell>{item.type}</TableCell>
{isSuperUser && (
    <TableCell>
        {item.notes ? (
            <CollapsibleNote note={item.notes} maxLength={50} />
        ) : null}
    </TableCell>
)}
                        <TableCell>{getStatusBadge(item.status)}</TableCell>
                        <TableCell className="text-right">
                            {canDeleteRequest(item) && (
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button variant="destructive" size="icon" className="h-8 w-8">
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Sei sicuro?</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                Questa azione non può essere annullata. Questa operazione eliminerà definitivamente la richiesta di permesso.
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Annulla</AlertDialogCancel>
                                            <AlertDialogAction onClick={() => handleDelete(item.id)}>Elimina</AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            )}
                        </TableCell>
                    </TableRow>
                ))
            )}
        </TableBody>
    </Table>
</div>
                         </>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
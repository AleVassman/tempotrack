"use client"
import * as React from "react"
import { add, format, eachDayOfInterval, startOfMonth, getDay, isSameMonth, isToday, differenceInDays, startOfDay, parseISO } from 'date-fns';
import { it } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth, UserProfile } from "@/app/layout";
import { collection, addDoc, serverTimestamp, query, where, getDocs, onSnapshot, orderBy, doc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useToast } from "./ui/use-toast";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { LEAVE_TYPES, TIME_OFF_STATUS, USER_ROLES } from "@/lib/constants";
import { QuickHelp } from "@/components/quick-help";

interface TimeOffRequest {
  id: string;
  userId: string;
  userName?: string;

  startDate: string;
  endDate: string;
  days: number;
  type: string;
  status: typeof TIME_OFF_STATUS[keyof typeof TIME_OFF_STATUS];

  // For partial day requests
  startTime?: string | null;
  endTime?: string | null;

  notes?: string;
  createdAt?: { seconds: number, nanoseconds: number };
}

interface TimeOffCalendarProps {
  onNewRequest: () => void;
}

interface SelectableUser {
    id: string;
    name: string;
    profile: UserProfile; // Store the full profile to get department info later
}

interface Holiday {
  date: string;
  name: string;
  departments?: string[];
  isPartial?: boolean;
  startTime?: string | null;
  endTime?: string | null;
}

export default function TimeOffCalendar({ onNewRequest }: TimeOffCalendarProps) {
  const { user, userProfile, loading: authLoading } = useAuth();
  const { toast } = useToast();

  const [currentMonth, setCurrentMonth] = React.useState(new Date());
  const [selectedDays, setSelectedDays] = React.useState<Date[]>([]);
  const [isDialogOpen, setIsDialogOpen] = React.useState(false);
  const [leaveType, setLeaveType] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [approvedRequests, setApprovedRequests] = React.useState<TimeOffRequest[]>([]);
  
  const [isPartialDay, setIsPartialDay] = React.useState(false);
  const [startTime, setStartTime] = React.useState('');
  const [endTime, setEndTime] = React.useState('');

  const [selectableUsers, setSelectableUsers] = React.useState<SelectableUser[]>([]);
  const [selectedUserId, setSelectedUserId] = React.useState('');

  const isHr = userProfile?.role === USER_ROLES.HR;
  const isAdmin = userProfile?.role === USER_ROLES.ADMIN;
  const isSuperUser = isHr || isAdmin;

  const selectedUserObj = isSuperUser && selectedUserId 
    ? selectableUsers.find(u => u.id === selectedUserId) 
    : null;

  const targetUserProfile = selectedUserObj ? selectedUserObj.profile : userProfile;

  const [holidays, setHolidays] = React.useState<Holiday[]>([]);

  // --- VERSIONE CORRETTA DELL'EFFECT ---
  React.useEffect(() => {
    const year = currentMonth.getFullYear().toString();
    const docRef = doc(db, "holidays", year);
    
    const unsub = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setHolidays(data.dates || []);
      } else {
        setHolidays([]);
      }
    });

    return () => unsub();
  }, [currentMonth]);

  // MODIFIED: This useEffect now contains the safety guard for admins
  React.useEffect(() => {
    if (!isSuperUser || !userProfile) return;

    let usersQuery;

    if (isHr) {
        usersQuery = query(collection(db, "users"), where("status", "==", "active"), orderBy("lastName"), orderBy("firstName"));
    } else if (isAdmin) {
        const managedDepts = userProfile.managedDepartments || [];
        
        // If the admin has no managed departments, don't run a query that will crash.
        if (managedDepts.length === 0) {
            // Just show the admin themselves in the list so they can make requests for themselves.
            if (user && userProfile) {
                setSelectableUsers([{
                    id: user.uid,
                    name: `${userProfile.firstName} ${userProfile.lastName} (Io)`,
                    profile: userProfile
                }]);
            }
            return; // Exit the effect immediately to prevent the crash
        }
        
        // Only build the query if the admin manages departments
        usersQuery = query(collection(db, "users"), where("department", "in", managedDepts), where("status", "==", "active"), orderBy("lastName"), orderBy("firstName"));
    }

    if (!usersQuery) return;
    
    const unsubscribe = onSnapshot(usersQuery, (snapshot) => {
        const usersList: SelectableUser[] = snapshot.docs.map(doc => ({
            id: doc.id,
            name: `${doc.data().firstName} ${doc.data().lastName}`,
            profile: doc.data() as UserProfile
        }));
        
        // Add self to the list if not already present
        if (isAdmin && user && userProfile && !usersList.some(u => u.id === user.uid)) {
            usersList.unshift({
                id: user.uid,
                name: `${userProfile.firstName} ${userProfile.lastName} (Io)`,
                profile: userProfile
            });
        }
        
        setSelectableUsers(usersList);

        // Automatically select the current user by default if no one is selected yet
        if (user) {
            setSelectedUserId((prev) => prev || user.uid);
        }
    });

    return () => unsubscribe();
  }, [isSuperUser, isHr, isAdmin, userProfile, user]);

  React.useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, "timeOffRequests"),
      where("userId", "==", user.uid),
      where("status", "==", TIME_OFF_STATUS.APPROVED)
    );
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const requests = querySnapshot.docs.map(doc => doc.data() as TimeOffRequest);
      setApprovedRequests(requests);
    });
    return () => unsubscribe();
  }, [user, currentMonth, authLoading]);
  
  // Reset form state when dialog opens or closes
  React.useEffect(() => {
    if (!isDialogOpen) {
        setSelectedDays([]);
        setLeaveType('');
        setNotes('');
        setIsPartialDay(false);
        setStartTime('');
        setEndTime('');
    }
  }, [isDialogOpen]);

  React.useEffect(() => {
    // If partial day is selected, only allow selecting one day.
    if (isPartialDay && selectedDays.length > 1) {
      setSelectedDays([selectedDays[0]]);
    }
  }, [isPartialDay, selectedDays]);

  // Reset calendar selection when the selected user changes
  React.useEffect(() => {
    setSelectedDays([]);
  }, [selectedUserId]);


  const handleOpenDialog = () => {
    if (selectedDays.length > 0) {
      setIsDialogOpen(true);
    }
  }


  const firstDayOfCurrentMonth = startOfMonth(currentMonth);
  const daysInMonth = eachDayOfInterval({
    start: firstDayOfCurrentMonth,
    end: add(firstDayOfCurrentMonth, { months: 1, days: -1 }),
  });
  
  const startingDayIndex = (getDay(firstDayOfCurrentMonth) + 6) % 7;


  const prevMonth = () => {
    const prev = add(firstDayOfCurrentMonth, { months: -1 });
    setCurrentMonth(prev);
  };

  const nextMonth = () => {
    const next = add(firstDayOfCurrentMonth, { months: 1 });
    setCurrentMonth(next);
  };

  type DayAbbr = 'LUN' | 'MAR' | 'MER' | 'GIO' | 'VEN' | 'SAB' | 'DOM';

  // Helper per capire se un giorno è festivo per l'utente attivo
  const isHolidayForMe = (date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    const holiday = holidays.find(h => h.date === dateStr);
    if (!holiday) return null;
    
    const depts = holiday.departments || [];
    // Se non ci sono dipartimenti è globale, altrimenti controlla se include quello del target
    if (depts.length === 0 || depts.includes(targetUserProfile?.department || 'Nessuno')) {
      return holiday;
    }
    return null;
  };

const handleDayClick = (day: Date) => {
    // 1. MUST USE targetUserProfile
    if (!targetUserProfile) return;

    const holiday = isHolidayForMe(day);
    if (holiday && !holiday.isPartial) {
      toast({
        variant: "destructive",
        title: "Giorno Festivo",
        description: `Il ${format(day, 'd MMM', { locale: it })} è già festivo per questo dipartimento (${holiday.name}).`,
      });
      return;
    }

    // Prevent selecting days in the past
    if (!isSuperUser && startOfDay(day) < startOfDay(new Date())) {
        toast({
            variant: 'destructive',
            title: "Data non valida",
            description: "Non è possibile selezionare giorni passati.",
        });
        return;
    }

    if (isPartialDay) {
        setSelectedDays([day]);
        return;
    }

    const newSelection = [...selectedDays, day];
    const sortedSelection = newSelection.sort((a, b) => a.getTime() - b.getTime());
    const firstDay = sortedSelection[0];
    const lastDay = sortedSelection[sortedSelection.length - 1];
    
    const dayWasAlreadySelected = selectedDays.some(d => d.getTime() === day.getTime());
    if (dayWasAlreadySelected) {
        setSelectedDays([]);
        return;
    }

    const fullRange = eachDayOfInterval({
      start: firstDay,
      end: lastDay,
    });

    const workDays = (targetUserProfile.workSchedule?.map(d => d.day) || 
        ['LUN', 'MAR', 'MER', 'GIO', 'VEN']) as DayAbbr[];
    
    const dayIndexToAbbr: DayAbbr[] = ['DOM', 'LUN', 'MAR', 'MER', 'GIO', 'VEN', 'SAB'];

    const filteredRange = fullRange.filter(d => {
        const dayAbbr = dayIndexToAbbr[d.getDay()];
        const isWorkDay = workDays.includes(dayAbbr);
        const dayHoliday = isHolidayForMe(d); // Usa la nuova funzione helper
        
        const isFullHoliday = dayHoliday && !dayHoliday.isPartial;

        // Gestione degli avvisi (Toast) se l'utente clicca direttamente sul giorno sbagliato
        if (d.getTime() === day.getTime()) {
            if (!isWorkDay) {
                toast({
                    variant: "destructive",
                    title: "Giorno non lavorativo",
                    description: "Hai selezionato un giorno non presente nel tuo orario di lavoro.",
                });
            } else if (isFullHoliday) {
                toast({
                    variant: "destructive",
                    title: "Giorno Festivo",
                    description: `Il ${format(day, 'd MMM', { locale: it })} è già festivo (${dayHoliday.name}).`,
                });
            }
        }
        
        // Un giorno viene aggiunto alla selezione solo se è lavorativo E NON è una festa intera
        return isWorkDay && !isFullHoliday;
    });

    setSelectedDays(filteredRange);
  };

  // --- HELPER FUNCTION ---

  /**
   * Checks for overlapping time-off requests before submitting a new one.
   * @param userId The ID of the user for whom the request is being made.
   * @param newRequestStart The start date of the new request.
   * @param newRequestEnd The end date of the new request.
   * @returns A promise that resolves to `null` if there are no overlaps, or an error message string if an overlap is found.
   */
  const checkForOverlaps = async (
    userId: string,
    newRequestStart: Date,
    newRequestEnd: Date,
    isNewRequestPartial: boolean,
    newRequestStartTime?: string,
    newRequestEndTime?: string
  ): Promise<string | null> => {
    
    // Find any existing request for this user where:
    // Its END date is ON OR AFTER our new request's START date.
    // This correctly narrows down the potential conflicts.
    const q = query(
      collection(db, "timeOffRequests"),
      where("userId", "==", userId),
      where("status", "in", [TIME_OFF_STATUS.PENDING, TIME_OFF_STATUS.APPROVED]),
      where("endDate", ">=", format(newRequestStart, "yyyy-MM-dd"))
    );

    try {
      const querySnapshot = await getDocs(q);
      const existingRequests = querySnapshot.docs.map(doc => doc.data() as TimeOffRequest);

      // Now, from that smaller list, find the first true conflict.
      // A true conflict is where the existing request's START date is ON OR BEFORE our new request's END date.
      for (const req of existingRequests) {
        const existingStart = parseISO(req.startDate);
        const existingEnd = parseISO(req.endDate);

        // Check for date overlap: (StartA <= EndB) AND (EndA >= StartB)
        const datesOverlap = newRequestStart <= existingEnd && newRequestEnd >= existingStart;

        if (!datesOverlap) {
          continue; // No date overlap, so this request is not a conflict. Move to the next one.
        }
        
        // --- If we get here, the DATES OVERLAP. Now we check the scenarios. ---

        // SCENARIO 1: UPGRADE. The new request fully contains the old one.
        // This is a valid "upgrade," so we let it pass. The backend will handle cleanup.
        const isUpgrade = newRequestStart <= existingStart && newRequestEnd >= existingEnd;
        if (isUpgrade) {
          continue; // Not a blocking conflict, check the next potential conflict.
        }

        // SCENARIO 2: PARTIAL DAY. Both are partial, so we check times.
        const isExistingRequestPartial = req.days === 0;
        if (isNewRequestPartial && isExistingRequestPartial && req.startTime && req.endTime && newRequestStartTime && newRequestEndTime) {
          const newStart = parseISO(`1970-01-01T${newRequestStartTime}:00`);
          const newEnd = parseISO(`1970-01-01T${newRequestEndTime}:00`);
          const existingStartTime = parseISO(`1970-01-01T${req.startTime}:00`);
          const existingEndTime = parseISO(`1970-01-01T${req.endTime}:00`);

          // If times do NOT overlap, it's not a conflict.
          if (newStart >= existingEndTime || newEnd <= existingStartTime) {
            continue; // Not a blocking conflict, check the next potential conflict.
          }
        }
        
        // SCENARIO 3: BLOCKING CONFLICT.
        // If we've reached this point, it means the dates overlap AND it's not a valid upgrade
        // OR it's a partial-day time collision. This is a real conflict and must be blocked.
        const conflictStartDate = format(existingStart, 'd MMM', { locale: it });
        const conflictEndDate = format(existingEnd, 'd MMM', { locale: it });
        return `Non è possibile creare la richiesta. Esiste già una richiesta di "${req.type}" dal ${conflictStartDate} al ${conflictEndDate}.`;
      }

      // If the loop finishes without finding any blocking conflicts, we are clear.
      return null;

    } catch (error) {
      console.error("Error checking for overlaps:", error);
      return "Errore durante la verifica di richieste esistenti. Riprova.";
    }
  };
  
  const handleRequestSubmit = async () => {
    if (!user || !userProfile) return;

    // --- Validation Block ---
    const isFormComplete = isPartialDay 
        ? leaveType && startTime && endTime && selectedDays.length > 0
        : leaveType && selectedDays.length > 0;

    if (!isFormComplete) {
        toast({ variant: "destructive", title: "Errore", description: "Per favore, compila tutti i campi richiesti." });
        return;
    }

    if (isSuperUser && !selectedUserId) {
        toast({ variant: "destructive", title: "Errore", description: "Per favore, seleziona un utente per cui creare la richiesta." });
        return;
    }
    // --- End Validation ---
    
    setIsSubmitting(true);
    try {
        // This part correctly determines who the request is for
        const targetUser = isSuperUser
            ? selectableUsers.find(u => u.id === selectedUserId)
            : { id: user.uid, name: `${userProfile.firstName || ''} ${userProfile.lastName || ''}`, profile: userProfile };

        if (!targetUser) {
            throw new Error("Utente selezionato non trovato.");
        }

        const startDate = startOfDay(selectedDays[0]);
        const endDate = startOfDay(selectedDays[selectedDays.length - 1]);

        // --- THIS IS THE NEW VALIDATION STEP ---
        const overlapError = await checkForOverlaps(
          targetUser.id, 
          startDate, 
          endDate, 
          isPartialDay, 
          startTime, 
          endTime
        );

        // 2. If an error message is returned, show it and stop the function.
        if (overlapError) {
            toast({
                variant: "destructive",
                title: "Richiesta in Conflitto",
                description: overlapError,
            });
            setIsSubmitting(false); // Make sure to reset the submitting state
            return; // Stop the execution
        }
        // --- END OF NEW VALIDATION STEP ---

        let requestStatus: 'In Sospeso' | 'Approvato' | 'Rifiutato' = TIME_OFF_STATUS.PENDING;
        let toastDescription = `La richiesta di permesso per ${targetUser.name.replace(" (Io)", "").trim()} è stata inviata.`;

        // The auto-approval condition:
        // Is the person submitting a Super User AND is the request for themselves?
        if (isSuperUser && targetUser.id === user.uid) {
            requestStatus = TIME_OFF_STATUS.APPROVED;
            toastDescription = "La tua richiesta di permesso è stata approvata automaticamente.";
        }

        await addDoc(collection(db, "timeOffRequests"), {
            userId: targetUser.id,
            userName: targetUser.name.replace(" (Io)", "").trim(),
            firstName: targetUser.profile.firstName || '',
            lastName: targetUser.profile.lastName || '',
            department: targetUser.profile.department || 'Nessuno',
            startDate: format(startDate, 'yyyy-MM-dd'),
            endDate: format(endDate, 'yyyy-MM-dd'),
            days: isPartialDay ? 0 : selectedDays.length,
            type: leaveType,
            notes: notes,
            status: requestStatus, // Use the dynamic status
            createdAt: serverTimestamp(),
            startTime: isPartialDay ? startTime : null,
            endTime: isPartialDay ? endTime : null,
        });

        toast({ title: "Successo", description: toastDescription }); // Use the dynamic toast message
        onNewRequest();
        setIsDialogOpen(false);
    } catch (error) {
        console.error("Error submitting request: ", error);
        toast({ variant: "destructive", title: "Errore", description: "Impossibile inviare la richiesta." });
    } finally {
        setIsSubmitting(false);
    }
};


  const getDaysWithStatus = () => {
    if (!targetUserProfile) {
        return {};
    }

    const days: { [key: string]: string } = {};

    // We explicitly tell TypeScript that this array will contain our specific DayAbbr types.
    const workDays = (targetUserProfile.workSchedule?.map(d => d.day) || 
        ['LUN', 'MAR', 'MER', 'GIO', 'VEN']) as DayAbbr[];
    
    const dayIndexToAbbr: DayAbbr[] = ['DOM', 'LUN', 'MAR', 'MER', 'GIO', 'VEN', 'SAB'];

    approvedRequests.forEach(req => {
        try {
            const interval = eachDayOfInterval({
                start: parseISO(req.startDate),
                end: parseISO(req.endDate)
            });

            const workDaysInInterval = interval.filter(day => {
                const dayAbbr = dayIndexToAbbr[day.getDay()];
                return workDays.includes(dayAbbr); // This will now be type-safe
            });

            workDaysInInterval.forEach(day => {
                days[format(day, 'yyyy-MM-dd')] = req.type;
            });
        } catch (e) {
            // Updated to reference req.id from the centralized type
            console.error("Skipping invalid date in request:", req.id, e);
        }
    });
    return days;
  };

  const approvedDays = getDaysWithStatus();
  
  // This variable is now accessible to the JSX below
const isFormComplete = isPartialDay 
    ? !!(leaveType && startTime && endTime && selectedDays.length > 0)
    : !!(leaveType && selectedDays.length > 0);

  return (
    <div className="p-2 sm:p-6 bg-card rounded-lg shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-4">
        
        {/* --- SEZIONE TITOLO / SELETTORE CON AIUTO --- */}
        {isSuperUser ? (
            <div className="flex items-center gap-2 w-full sm:w-auto">
                 <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                    <SelectTrigger className="w-full sm:w-[250px]">
                        <SelectValue placeholder="Seleziona dipendente" />
                    </SelectTrigger>
                    <SelectContent>
                        {selectableUsers.map(u => (
                            <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <QuickHelp 
                  title="Guida alla Selezione"
                  content="Per selezionare un periodo, clicca sul primo giorno e poi sull'ultimo. Il sistema evidenzierà i giorni lavorativi. Clicca su un giorno già selezionato per annullare tutto."
                />
            </div>
        ) : (
             <div className="flex items-center gap-2 text-center sm:text-left">
                <h2 className="font-headline text-lg font-semibold capitalize">
                    {format(firstDayOfCurrentMonth, 'MMMM yyyy', { locale: it })}
                </h2>
                <QuickHelp 
                  title="Come richiedere un permesso"
                  content="Clicca sulla data di inizio e poi sulla data di fine. I giorni di riposo e le festività verranno esclusi automaticamente dal conteggio totale."
                />
             </div>
        )}

        <div className="flex items-center justify-between sm:justify-end gap-2 w-full sm:w-auto">
          {isSuperUser && (
             <span className="font-headline text-lg font-semibold capitalize mr-2 hidden xl:block">
                {format(firstDayOfCurrentMonth, 'MMMM yyyy', { locale: it })}
             </span>
          )}
          
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={prevMonth} aria-label="Mese Precedente">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={nextMonth} aria-label="Mese Successivo">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button size="sm" onClick={() => setIsDialogOpen(true)} disabled={selectedDays.length === 0} className="flex-grow sm:flex-grow-0">
            Richiedi Permesso
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px text-center text-xs font-semibold text-muted-foreground border-t border-l">
        {['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'].map(day => <div key={day} className="py-2 border-b border-r bg-card text-[10px] sm:text-xs">{day}</div>)}
        {Array.from({ length: startingDayIndex }).map((_, i) => <div key={`empty-${i}`} className="border-b border-r bg-card h-12 sm:h-auto" />)}
        {daysInMonth.map(day => {
          const formattedDay = format(day, 'yyyy-MM-dd');
          const holiday = isHolidayForMe(day);
          const isFullHoliday = holiday && !holiday.isPartial;
          const isPartialHoliday = holiday && holiday.isPartial;
          
          const isApproved = !!approvedDays[formattedDay];
          const isSelected = selectedDays.some(d => d.getTime() === day.getTime());
          const isPast = !isSuperUser && startOfDay(day) < startOfDay(new Date());
          
          return (
            <div 
              key={day.toString()} 
              onClick={() => handleDayClick(day)} 
              className={cn(
                "relative py-2 border-b border-r transition-colors h-12 sm:py-2 sm:h-auto flex items-center justify-center",
                // Grigio se è passato o se è festa intera
                (isPast || isFullHoliday) ? "bg-muted/50 text-muted-foreground" : "cursor-pointer hover:bg-secondary",
                // Arancione chiarissimo se è mezza festa
                isPartialHoliday && "bg-amber-50 dark:bg-amber-900/10",
                isSelected && "bg-primary/20",
                isApproved && "bg-green-100 dark:bg-green-900"
              )}
            >
              <time dateTime={formattedDay} className={cn("mx-auto flex h-7 w-7 items-center justify-center rounded-full", isToday(day) && !isSelected && 'bg-accent text-accent-foreground')}>
                {format(day, 'd')}
              </time>
              
              {holiday && (
                <div 
                  className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-amber-500" 
                  title={holiday.name} 
                />
              )}

              {isApproved && <div className="absolute bottom-1 left-1/2 -translate-x-1/2 h-1.5 w-1.5 rounded-full bg-green-500"></div>}
            </div>
          );
        })}
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[425px] w-[92vw] max-h-[95vh] overflow-y-auto p-4 sm:p-6 rounded-lg">
          <DialogHeader>
            <DialogTitle>Richiedi Permesso</DialogTitle>
            <DialogDescription>
                {targetUserProfile && isSuperUser && (
                    <span className="block font-medium text-primary mb-1">
                        Per: {targetUserProfile.firstName} {targetUserProfile.lastName}
                    </span>
                )}
                {selectedDays.length > 0 && `Dal ${format(selectedDays[0], 'd MMM', { locale: it })} al ${format(selectedDays[selectedDays.length - 1], 'd MMM, yyyy', { locale: it })}.`}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="leave-type" className="text-right">Tipo</Label>
              <Select onValueChange={setLeaveType} value={leaveType}>
                <SelectTrigger className="col-span-3"><SelectValue placeholder="Seleziona un tipo" /></SelectTrigger>
                <SelectContent>{LEAVE_TYPES.map(type => <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            
            <div className="flex items-center gap-4">
              <QuickHelp
                  title="Cos'è il permesso orario?"
                  content="Attiva questa opzione se hai bisogno di un permesso solo per alcune ore della giornata (es. una visita medica). Dovrai specificare l'orario di inizio e fine."
                />
                <Label htmlFor="partial-day" className="text-right">Permesso orario</Label>
              <Switch id="partial-day" checked={isPartialDay} onCheckedChange={setIsPartialDay} />
            </div>
            {isPartialDay && (
              <>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="start-time" className="text-right">Dalle</Label>
                  <Input id="start-time" type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className="col-span-3" />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="end-time" className="text-right">Alle</Label>
                  <Input id="end-time" type="time" value={endTime} onChange={e => setEndTime(e.target.value)} className="col-span-3" />
                </div>
              </>
            )}
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="notes" className="text-right">Note</Label>
              <Textarea id="notes" placeholder="Note opzionali per il tuo manager." className="col-span-3" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end sm:gap-2">
            <DialogClose asChild>
              <Button type="button" variant="secondary" disabled={isSubmitting}>Annulla</Button>
            </DialogClose>
            <Button 
              type="submit" 
              onClick={handleRequestSubmit} 
              disabled={isSubmitting || !isFormComplete}
            >
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Invia Richiesta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
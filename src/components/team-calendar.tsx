"use client";

import * as React from "react";
import { add, format, eachDayOfInterval, startOfMonth, getDay, isSameMonth, isToday, parseISO } from 'date-fns';
import { it } from 'date-fns/locale';
import { CalendarCheck, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useIsMobile } from "@/hooks/use-mobile";
import { UserProfile } from "@/app/layout";
import { ScrollArea } from "@/components/ui/scroll-area";
import { QuickHelp } from "@/components/quick-help";

// --- INTERFACES ---

interface TimeOffRequest {
  id: string;
  userId: string;
  startDate: string;
  endDate: string;
  type: string;
  userName?: string;
  startTime?: string | null;
  endTime?: string | null;
}

// FIX: Struttura Holiday aggiornata
interface HolidayData {
    date: string;
    name: string;
    departments?: string[];
    isPartial?: boolean;
    startTime?: string | null;
    endTime?: string | null;
}

interface CalendarEvent {
  userName: string;
  type: string;
  timeSpan?: string;
  isPartialHoliday?: boolean; // Serve per variare il colore
}

interface TeamCalendarProps {
    requests: TimeOffRequest[];
    holidays: HolidayData[]; // Aggiornato
    compensatoryDays: Map<string, CalendarEvent[]>;
    allUsers: UserProfile[];
    loading: boolean;
}

type DayAbbr = 'LUN' | 'MAR' | 'MER' | 'GIO' | 'VEN' | 'SAB' | 'DOM';

export default function TeamCalendar({ requests, holidays, compensatoryDays, allUsers, loading }: TeamCalendarProps) {
  const [currentMonth, setCurrentMonth] = React.useState(new Date());
  const [selectedDayEvents, setSelectedDayEvents] = React.useState<CalendarEvent[]>([]);
  const [isDialogOpen, setIsDialogOpen] = React.useState(false);
  const [selectedDate, setSelectedDate] = React.useState<Date | null>(null);
  const isMobile = useIsMobile();

  const firstDayOfCurrentMonth = startOfMonth(currentMonth);

  const eventsByDay = React.useMemo(() => {
    const events = new Map<string, CalendarEvent[]>();
    const userMap = new Map<string, UserProfile>(allUsers.map((u: UserProfile) => [u.id || '', u]));
    const dayIndexToAbbr: DayAbbr[] = ['DOM', 'LUN', 'MAR', 'MER', 'GIO', 'VEN', 'SAB'];

    // Funzione helper interna per capire se un utente ha festa in quel giorno
    const getHolidayForUser = (dateStr: string, dept?: string) => {
        const holiday = holidays.find(h => h.date === dateStr);
        if (!holiday) return null;
        const depts = holiday.departments;
        if (!depts || depts.length === 0) return holiday; // Festa Globale
        if (depts.includes(dept || 'Nessuno')) return holiday; // Festa per Dipartimento
        return null;
    };

    // 1. Processa Permessi Ordinari
    requests.forEach(req => {
      try {
        const userForRequest = userMap.get(req.userId);
        if (!userForRequest) return;

        const workDays = (userForRequest.workSchedule?.map((d: {day: DayAbbr}) => d.day) || 
            ['LUN', 'MAR', 'MER', 'GIO', 'VEN']) as DayAbbr[];
        
        const interval = eachDayOfInterval({ start: parseISO(req.startDate), end: parseISO(req.endDate) });

        const workDaysInInterval = interval.filter(day => {
            const dayAbbr = dayIndexToAbbr[day.getDay()];
            return workDays.includes(dayAbbr);
        });

        let timeSpan = "";
        if (req.startTime && req.endTime) {
            timeSpan = `${req.startTime}-${req.endTime}`;
        }

        workDaysInInterval.forEach(day => {
          const formattedDay = format(day, 'yyyy-MM-dd');
          
          const userHoliday = getHolidayForUser(formattedDay, userForRequest.department);
          
          // FIX: Aggiungi il permesso SOLO SE NON c'è una festività INTERA
          if (!userHoliday || userHoliday.isPartial) {
            const dayEvents = events.get(formattedDay) ||[];
            events.set(formattedDay, [...dayEvents, { type: req.type, userName: req.userName || 'Sconosciuto', timeSpan }]);
          }
        });
      } catch (e) { console.error(`Error processing request in TeamCalendar:`, req.id, e); }
    });

    // 2. Processa Giorni di Recupero (sono già stati filtrati dalle festività intere in page.tsx)
    compensatoryDays.forEach((compEvents, date) => {
        const dayEvents = events.get(date) ||[];
        events.set(date, [...dayEvents, ...compEvents]);
    });

    // 3. Processa Festività
    holidays.forEach(holiday => {
      const depts = holiday.departments ||[];
      // Se non ha dipartimenti, o se per caso sono stati selezionati tutti i dipartimenti disponibili
      // (assumendo che la logica del form li salvi tutti), la consideriamo globale.
      const isGlobal = depts.length === 0; 
      let timeSpan = holiday.isPartial && holiday.startTime && holiday.endTime ? `${holiday.startTime}-${holiday.endTime}` : undefined;

      if (isGlobal) {
          // Festività globale: mostra un solo blocco generico (es. "Natale")
          const dayEvents = events.get(holiday.date) ||[];
          events.set(holiday.date, [...dayEvents, { 
              type: 'Giorno Festivo', 
              userName: holiday.name, 
              timeSpan,
              isPartialHoliday: holiday.isPartial 
          }]);
      } else {
          // --- FIX: Festività per dipartimento ---
          // Invece di cercare gli utenti, creiamo un blocco per OGNI DIPARTIMENTO
          const holidayEvents = depts.map(deptName => ({
              type: 'Giorno Festivo',
              userName: deptName, // Mostra il nome del dipartimento (es. "Sales")
              timeSpan: timeSpan ? `${holiday.name} (${timeSpan})` : holiday.name, // Nel tooltip o nel dialog mostriamo il nome della festa
              isPartialHoliday: holiday.isPartial
          }));
          
          const dayEvents = events.get(holiday.date) ||[];
          events.set(holiday.date, [...dayEvents, ...holidayEvents]);
      }
    });

    return events;
  }, [requests, holidays, compensatoryDays, allUsers]);
  
  const daysInMonth = eachDayOfInterval({ start: firstDayOfCurrentMonth, end: add(firstDayOfCurrentMonth, { months: 1, days: -1 }) });
  const startingDayIndex = (getDay(firstDayOfCurrentMonth) + 6) % 7;

  const prevMonth = () => setCurrentMonth(add(firstDayOfCurrentMonth, { months: -1 }));
  const nextMonth = () => setCurrentMonth(add(firstDayOfCurrentMonth, { months: 1 }));

  const handleDayClick = (date: Date) => {
    const dayEvents = eventsByDay.get(format(date, 'yyyy-MM-dd'));
    if (isMobile && dayEvents && dayEvents.length > 0) {
      setSelectedDayEvents(dayEvents);
      setSelectedDate(date);
      setIsDialogOpen(true);
    }
  };

  // Aggiornato per accettare l'intero oggetto event per controllare isPartialHoliday
  const getEventStyling = (event: CalendarEvent) => {
    switch (event.type) {
      case 'Recupero Straordinari':
        return { bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-800 dark:text-purple-200', dot: 'bg-purple-500' };
      case 'Recupero':
        return { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-800 dark:text-green-200', dot: 'bg-green-500' };
      case 'Giorno Festivo':
        return { 
            // Usa un arancione più chiaro se è una festa parziale
            bg: event.isPartialHoliday ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200' : 'bg-amber-100 dark:bg-amber-900/40', 
            text: 'text-amber-800 dark:text-amber-200', 
            dot: 'bg-amber-500' 
        };
      default:
        return { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-800 dark:text-blue-200', dot: 'bg-blue-500' };
    }
  };

  return (
    <TooltipProvider>
      <div className="bg-card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h2 className="font-headline text-lg font-semibold capitalize">
              {format(firstDayOfCurrentMonth, 'MMMM yyyy', { locale: it })}
            </h2>
            <QuickHelp 
                title="Legenda Colori"
                content={
                    <div className="space-y-2">
                        <p>I colori indicano il tipo di assenza o evento:</p>
                        <ul className="space-y-1">
                            <li><span className="font-bold text-blue-600">● Blu:</span> Ferie o Permessi ordinari.</li>
                            <li><span className="font-bold text-purple-600">● Viola:</span> Recupero Straordinari.</li>
                            <li><span className="font-bold text-green-600">● Verde:</span> Giorno di Recupero settimanale.</li>
                            <li><span className="font-bold text-amber-600">● Arancione:</span> Festività. (Bordato se mezza giornata).</li>
                        </ul>
                        <p className="pt-1 border-t text-[10px]">Su mobile, clicca sul giorno per i dettagli.</p>
                    </div>
                }
            />
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={prevMonth} aria-label="Mese Precedente">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={nextMonth} aria-label="Mese Successivo">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
        
        {loading ? (
            <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
        ) : (
        <div className="grid grid-cols-7 gap-px text-center text-xs font-semibold text-muted-foreground border-t border-l">
          {['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'].map(day => <div key={day} className="py-2 border-b border-r bg-card">{day}</div>)}
          {Array.from({ length: startingDayIndex }).map((_, i) => <div key={`empty-${i}`} className="border-b border-r bg-muted/50 h-16 sm:h-24"/>)}
          
          {daysInMonth.map(day => {
            const formattedDay = format(day, 'yyyy-MM-dd');
            const dayEvents = eventsByDay.get(formattedDay);
            const isHoliday = dayEvents?.some(e => e.type === 'Giorno Festivo');
            
            return (
              <div 
                key={day.toString()} 
                onClick={() => handleDayClick(day)} 
                className={cn(
                  "relative p-1 border-b border-r text-left align-top h-16 sm:h-24", 
                  isHoliday ? "bg-amber-50 dark:bg-amber-900/20" : (isSameMonth(day, firstDayOfCurrentMonth) ? "bg-card" : "bg-muted/50"), 
                  isMobile && dayEvents && dayEvents.length > 0 ? "cursor-pointer" : ""
                )}
              >
                <time dateTime={formattedDay} className={cn("text-[10px] sm:text-xs font-medium", isToday(day) && 'flex items-center justify-center h-6 w-6 rounded-full bg-primary text-primary-foreground')}>
                  {format(day, 'd')}
                </time>
                
                 <div 
                    className={cn(
                      "mt-1 space-y-0.5 overflow-y-auto pr-0.5 pb-2",
                      isToday(day) 
                        ? "max-h-[38px] sm:max-h-[62px]"
                        : "max-h-[48px] sm:max-h-[70px]"
                    )}
                  >
                    {!isMobile && dayEvents?.map((event, index) => { 
                      const styling = getEventStyling(event); // Passiamo l'intero evento
                      return (
                        <Tooltip key={index}>
                          <TooltipTrigger asChild>
                            <div className={cn("text-[9px] sm:text-[10px] p-0.5 rounded-sm truncate", styling.bg)}>
                                <span className={cn("font-semibold", styling.text)}>
                                  {event.userName}
                                </span>
                              </div>
                            </TooltipTrigger>
                          <TooltipContent>
                            <p>
                              {event.userName} - {event.type}
                              {event.timeSpan && <span className="ml-1 opacity-90">({event.timeSpan})</span>}
                            </p>
                          </TooltipContent>
                        </Tooltip>); 
                      })}
                    {isMobile && dayEvents && dayEvents.length > 0 && (
                      <div className="absolute bottom-1 right-1 flex flex-col items-end gap-0.5">
                        <div className="flex items-center gap-1">
                          {dayEvents.slice(0, dayEvents.length > 3 ? 2 : 3).map((event, index) => (
                            <div key={index} className={cn("h-2 w-2 rounded-full", getEventStyling(event).dot)} />
                          ))}
                        </div>
                        {dayEvents.length > 3 && (
                          <span className="text-[9px] font-bold text-muted-foreground leading-none pr-px">+{dayEvents.length - 2}</span>
                        )}
                      </div>
                    )}
                </div>
              </div>
            );
          })}
        </div>
        )}
      </div>

       <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Dettagli del {selectedDate ? format(selectedDate, 'd MMMM yyyy', { locale: it }) : ''}</DialogTitle>
                    <DialogDescription>Elenco degli eventi per questa giornata.</DialogDescription>
                </DialogHeader>
                <ScrollArea className="max-h-[60vh] pr-4">
                    <div className="space-y-2 py-4">
                        {selectedDayEvents.map((event: CalendarEvent, index: number) => { 
                          const styling = getEventStyling(event); 
                          return (
                            <div key={index} className={cn("flex items-center justify-between gap-3 p-3 rounded-md", styling.bg)}>
                                <div className="flex flex-col">
                                    <span className={cn("font-medium", styling.text)}>{event.userName}</span>
                                    <div className="flex gap-2 text-sm text-muted-foreground">
                                        <span>{event.type}</span>
                                        {event.timeSpan && <span>• {event.timeSpan}</span>}
                                    </div>
                                </div>
                                {event.type === 'Giorno Festivo' && <CalendarCheck className="h-4 w-4 text-amber-600 opacity-50"/>}
                            </div>
                        ); })}
                    </div>
                </ScrollArea>
            </DialogContent>
        </Dialog>
    </TooltipProvider>
  );
}
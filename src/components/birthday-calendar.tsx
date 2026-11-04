"use client"
import * as React from "react"
import { add, format, eachDayOfInterval, startOfMonth, getDay, isSameMonth, isToday, parseISO, setYear } from 'date-fns';
import { it } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Cake } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
// NEW: Import Dialog components and useIsMobile hook
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useIsMobile } from "@/hooks/use-mobile";

// --- INTERFACES ---
interface User {
  id: string;
  firstName?: string;
  lastName?: string;
  compleanno?: string; // YYYY-MM-DD
}

interface BirthdayCalendarProps {
    users: User[];
}

interface DayWithBirthdays {
    birthdays: {
        userName: string;
    }[];
}

export default function BirthdayCalendar({ users }: BirthdayCalendarProps) {
  const [currentMonth, setCurrentMonth] = React.useState(new Date());
  // NEW: State for the mobile dialog
  const [selectedDayBirthdays, setSelectedDayBirthdays] = React.useState<DayWithBirthdays['birthdays']>([]);
  const [isDialogOpen, setIsDialogOpen] = React.useState(false);
  const [selectedDate, setSelectedDate] = React.useState<Date | null>(null);
  const isMobile = useIsMobile();


  const firstDayOfCurrentMonth = startOfMonth(currentMonth);
  const daysInMonth = eachDayOfInterval({
    start: firstDayOfCurrentMonth,
    end: add(firstDayOfCurrentMonth, { months: 1, days: -1 }),
  });
  
  const startingDayIndex = (getDay(firstDayOfCurrentMonth) + 6) % 7;

  const prevMonth = () => setCurrentMonth(add(firstDayOfCurrentMonth, { months: -1 }));
  const nextMonth = () => setCurrentMonth(add(firstDayOfCurrentMonth, { months: 1 }));

  const daysWithBirthdays = React.useMemo(() => {
      const days: Record<string, DayWithBirthdays> = {};
      const currentYear = currentMonth.getFullYear();

      users.forEach(user => {
          if (user.compleanno) {
              try {
                const birthDate = setYear(parseISO(user.compleanno), currentYear);
                if (isSameMonth(birthDate, currentMonth)) {
                    const formattedDay = format(birthDate, 'yyyy-MM-dd');
                    if (!days[formattedDay]) {
                        days[formattedDay] = { birthdays: [] };
                    }
                    days[formattedDay].birthdays.push({
                        userName: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
                    });
                }
              } catch(e) { console.error("Invalid birthday format for user", user.id, e) }
          }
      });
      return days;
  }, [users, currentMonth]);

  // NEW: Click handler for mobile
  const handleDayClick = (dayInfo: DayWithBirthdays | undefined, date: Date) => {
    if (isMobile && dayInfo && dayInfo.birthdays.length > 0) {
        setSelectedDayBirthdays(dayInfo.birthdays);
        setSelectedDate(date);
        setIsDialogOpen(true);
    }
  }


  return (
    <TooltipProvider>
      <div className="bg-card rounded-lg border shadow-sm p-4 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-headline text-lg font-semibold capitalize">{format(firstDayOfCurrentMonth, 'MMMM yyyy', { locale: it })}</h2>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={prevMonth}><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="outline" size="icon" onClick={nextMonth}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-px text-center text-xs font-semibold text-muted-foreground border-t border-l">
          {['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'].map(day => (
            <div key={day} className="py-2 border-b border-r bg-card">{day}</div>
          ))}
          {Array.from({ length: startingDayIndex }).map((_, i) => (
            <div key={`empty-${i}`} className="border-b border-r bg-muted/50 h-16 sm:h-24"/>
          ))}
          {daysInMonth.map(day => {
            const formattedDay = format(day, 'yyyy-MM-dd');
            const dayInfo = daysWithBirthdays[formattedDay];
            const hasBirthdays = dayInfo && dayInfo.birthdays.length > 0;
            
            return (
              <div
                key={day.toString()}
                onClick={() => handleDayClick(dayInfo, day)}
                className={cn(
                  "relative p-1 border-b border-r text-left align-top h-16 sm:h-24",
                  isSameMonth(day, firstDayOfCurrentMonth) ? "bg-card" : "bg-muted/50",
                  // Make the cell clickable on mobile if there's a birthday
                  hasBirthdays && isMobile && "cursor-pointer"
                )}
              >
                <time dateTime={format(day, 'yyyy-MM-dd')} className={cn("text-[10px] sm:text-xs font-medium", isToday(day) && 'flex items-center justify-center h-6 w-6 rounded-full bg-primary text-primary-foreground')}>
                  {format(day, 'd')}
                </time>
                 <div className="mt-1 space-y-0.5 overflow-y-auto max-h-[48px] sm:max-h-[70px]">
                    {/* NEW: Mobile View - Show only an icon */}
                    {hasBirthdays && isMobile && (
                        <div className="flex justify-center items-center pt-2">
                           <Cake className="h-5 w-5 text-pink-500" />
                        </div>
                    )}
                    
                    {/* NEW: Desktop View - Show names */}
                    {hasBirthdays && !isMobile && dayInfo.birthdays.map((bday, index) => (
                       <Tooltip key={index}>
                            <TooltipTrigger asChild>
                                <div className="bg-pink-600/10 text-[9px] sm:text-[10px] p-0.5 rounded-sm truncate flex items-center gap-1">
                                    <Cake className="h-3 w-3 text-pink-700 dark:text-pink-300 flex-shrink-0"/>
                                    <span className="font-semibold text-pink-700 dark:text-pink-300">{bday.userName}</span>
                                </div>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>Compleanno di {bday.userName}</p>
                            </TooltipContent>
                        </Tooltip>
                    ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

       {/* NEW: Dialog for displaying birthday names on mobile */}
       <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Compleanni del {selectedDate ? format(selectedDate, 'd MMMM yyyy', { locale: it }) : ''}</DialogTitle>
                    <DialogDescription>Elenco dei colleghi che festeggiano il compleanno oggi.</DialogDescription>
                </DialogHeader>
                <div className="mt-4 space-y-4">
                    {selectedDayBirthdays.map((bday, index) => (
                        <div key={index} className="flex items-center gap-3 p-3 rounded-md bg-secondary">
                            <Cake className="h-5 w-5 text-pink-500"/>
                            <span className="font-medium text-secondary-foreground">{bday.userName}</span>
                        </div>
                    ))}
                </div>
            </DialogContent>
        </Dialog>
    </TooltipProvider>
  )
}

"use client";
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Sidebar, SidebarHeader, SidebarContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarFooter } from '@/components/ui/sidebar';
import { Home, Calendar, Clock, FileText, Users, BarChart3, CalendarDays, Palmtree } from 'lucide-react';
import { useAuth } from '@/app/layout';
import { InstallGuideButton } from '@/components/install-guide';
import { USER_ROLES } from '@/lib/constants';

const navItems = [
  { href: '/', icon: <Home />, label: 'Dashboard', requiresHr: false, requiresSuperUser: false },
  { href: '/timesheets', icon: <Clock />, label: 'Foglio Ore', requiresHr: false, requiresSuperUser: false },
  { href: '/time-off', icon: <Calendar />, label: 'Permessi', requiresHr: false, requiresSuperUser: false },
  // { href: '/documents', icon: <FileText />, label: 'Documenti', requiresHr: false, requiresSuperUser: false },
  { href: '/organizzazione', icon: <Users />, label: 'Organizzazione', excludesHr: true },
  { href: '/planner', icon: <CalendarDays />, label: 'Planner Assenze', requiresHr: false, requiresSuperUser: true },
  { href: '/reports', icon: <BarChart3 />, label: 'Report Assenze', requiresHr: false, requiresSuperUser: true },
  { href: '/users', icon: <Users />, label: 'Gestione Utenti', requiresHr: true, requiresSuperUser: false },
  { href: '/festivita', icon: <Palmtree />, label: 'Gestione Festività', requiresHr: true, requiresSuperUser: false },
];

const TempoTrackLogo = () => (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-primary">
      <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M12 6V12L16 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );

export function AppSidebar() {
  const pathname = usePathname();
  const { userProfile } = useAuth();
  // const isSuperUser = userProfile?.role === 'admin' || userProfile?.role === 'hr';
  // const isHr = userProfile?.role === 'hr';
  const isSuperUser = userProfile?.role === USER_ROLES.ADMIN || userProfile?.role === USER_ROLES.HR;
  const isHr = userProfile?.role === USER_ROLES.HR;

  return (
    <Sidebar className="z-40">
      <SidebarHeader>
        <div className="flex items-center gap-2 p-2">
            <TempoTrackLogo/>
            <h1 className="font-headline text-xl font-semibold text-foreground group-data-[collapsible=icon]:hidden">TempoTrack</h1>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu>
          {navItems.filter(item => {
            if (item.requiresHr) {
              return isHr;
            }
            if (item.requiresSuperUser) {
              return isSuperUser;
            }
            if (item.excludesHr) {
              return !isHr;
            }
            return true;
          }).map((item) => (
            <SidebarMenuItem key={item.href}>
              <Link href={item.href}>
                <SidebarMenuButton 
                  isActive={pathname === item.href}
                  tooltip={item.label}
                  className="justify-start"
                >
                  {item.icon}
                  <span>{item.label}</span>
                </SidebarMenuButton>
              </Link>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter>
        <InstallGuideButton />
      </SidebarFooter>
    </Sidebar>
  );
}

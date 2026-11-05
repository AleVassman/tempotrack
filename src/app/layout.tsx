
"use client";

import './globals.css';
import { Toaster } from '@/components/ui/toaster';
import { AppSidebar } from '@/components/app-sidebar';
import AppHeader from '@/components/app-header';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, createContext, useContext } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { DAYS_OF_WEEK, USER_ROLES } from '@/lib/constants';
import { OfflineIndicator } from '@/components/offline-indicator';
import { DepartmentsProvider } from '@/hooks/use-departments';

export interface WorkDay {
  day: typeof DAYS_OF_WEEK[number]['id'];
  hours: number;
}

export interface WeeklyCompensatoryTimeOff {
  day: typeof DAYS_OF_WEEK[number]['id'];
  minutes: number;
  startTime?: string; 
  endTime?: string;
}

export interface UserProfile {
  id?: string;
  email?: string;
  contactEmail?: string;
  cellphone?: string;
  role?: typeof USER_ROLES[keyof typeof USER_ROLES];
  department?: string;
  firstName?: string;
  lastName?: string;
  workStartTime?: string;
  workEndTime?: string;
  lunchStartTime?: string;
  lunchEndTime?: string;
  isClockedIn?: boolean;
  clockInTime?: string;
  workSchedule?: WorkDay[];
  weeklyCompensatoryDay?: WeeklyCompensatoryTimeOff;
  managedDepartments?: string[];
}

interface AuthContextType {
  user: User | null;
  userProfile: UserProfile | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType>({ user: null, userProfile: null, loading: true });

export const useAuth = () => useContext(AuthContext);

function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    // We only want to register the PWA service worker in production
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
          .then((registration) => {
            console.log('PWA Service Worker registered successfully:', registration.scope);
          })
          .catch((error) => {
            console.error('PWA Service Worker registration failed:', error);
          });
      });
    }
  }, []);

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (user) {
        setUser(user);
      } else {
        setUser(null);
        setUserProfile(null);
        setLoading(false);
      }
    });
    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    if (user) {
      const userDocRef = doc(db, 'users', user.uid);
      const unsubscribeProfile = onSnapshot(userDocRef, (doc) => {
        if (doc.exists()) {
          setUserProfile(doc.data() as UserProfile);
        } else {
          console.log("User profile not found for UID:", user.uid, "- Defaulting to 'user' role.");
          setUserProfile({ role: USER_ROLES.USER });
        }
        setLoading(false);
      }, (error) => {
          console.error("Error fetching user profile:", error);
          setLoading(false);
      });

      return () => unsubscribeProfile();
    }
  }, [user]);


  useEffect(() => {
    if (loading) return;

    const isLoginPage = pathname === '/login';

    if (!user && !isLoginPage) {
      router.push('/login');
    } else if (user && isLoginPage) {
      router.push('/');
    }
  }, [user, loading, pathname, router]);

  if (loading) {
    return (
      <html lang="it" suppressHydrationWarning>
        <body className="font-body antialiased bg-background">
            <div className="flex h-screen w-full items-center justify-center">
            </div>
        </body>
      </html>
    );
  }
  
  const value = { user, userProfile, loading };

  return (
    <AuthContext.Provider value={value}>
     <DepartmentsProvider enabled={!!user} canSeed={userProfile?.role === USER_ROLES.HR}>
      {/* These components are global and should be outside the main layout logic */}
      <Toaster />
      <OfflineIndicator />

      {!user && pathname === '/login' ? (
        // Render only the children for the login page
        children
      ) : user ? (
        // Render the full app layout for authenticated users
          <SidebarProvider>
            <div className="flex min-h-screen w-full">
              <AppSidebar />
              <div className="flex flex-1 flex-col min-w-0">
                <AppHeader />
                <SidebarInset className="min-w-0">
                  <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 bg-background">
                    {children}
                  </main>
                </SidebarInset>
              </div>
            </div>
          </SidebarProvider>
      ) : null}
     </DepartmentsProvider>
    </AuthContext.Provider>
  );
}


export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {

  return (
    <html lang="it" suppressHydrationWarning>
      <head>
        <title>TempoTrack</title>
        <meta name="description" content="Una moderna applicazione per la gestione delle risorse umane." />
        <meta name="robots" content="noindex, nofollow" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#3399FF" />
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
        <meta name="apple-mobile-web-app-status-bar" content="#3399FF" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className="font-body antialiased bg-background">
          <AuthProvider>
            <Toaster />
            {children}
          </AuthProvider>
      </body>
    </html>
  );
}

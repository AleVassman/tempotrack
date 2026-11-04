"use client"
import { useState, useEffect } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { LogOut, BellRing } from "lucide-react"
import { signOut } from "firebase/auth"
import { auth } from "@/lib/firebase"
import { useAuth } from "@/app/layout"
import { onSnapshot } from "firebase/firestore";
import { NotificationBell } from "@/components/notification-bell";
import { NotificationCenter } from "@/components/notification-center";
import { getUserNotificationsQuery } from "@/lib/notifications";
import { AppNotification } from "@/types/notification";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export default function AppHeader() {
  const { user, userProfile } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showNotifications, setShowNotifications] = useState(false);
  
  const { permissionStatus, requestPermissionAndToken } = usePushNotifications();


  // Real-time notifications listener
  useEffect(() => {
    if (!user) {
      setNotifications([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    
    const unsubscribe = onSnapshot(
      getUserNotificationsQuery(user.uid),
      (snapshot) => {
        const notificationsData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
          createdAt: doc.data().createdAt?.toDate() || new Date(),
        })) as AppNotification[];
        
        setNotifications(notificationsData);
        setIsLoading(false);
      },
      (error) => {
        console.error("Error listening to notifications:", error);
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user]);

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      // La ridirezione alla pagina di login è gestita dal RootLayout
    } catch (error) {
      console.error("Errore durante il logout:", error);
    }
  };
  
  const getInitials = () => {
    const firstName = userProfile?.firstName || '';
    const lastName = userProfile?.lastName || '';
    if (firstName && lastName) {
        return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
    }
    return user?.email?.charAt(0).toUpperCase() || 'U';
  }
  
  const displayName = userProfile?.firstName && userProfile?.lastName 
    ? `${userProfile.firstName} ${userProfile.lastName}` 
    : user?.email;

  const unreadCount = notifications.filter(n => !n.read).length;

  const handleNotificationsChange = () => {
    // This will trigger a re-render to show updated notifications
    setNotifications(prev => [...prev]);
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b bg-background/95 backdrop-blur-sm px-4 md:px-6">
      <div className="md:hidden">
        <SidebarTrigger />
      </div>

      <div className="w-full flex-1">
        {/* Can be used for search or breadcrumbs */}
      </div>

      <div className="flex items-center gap-4">

        {/* Conditionally render the "Enable Push Notifications" button */}
        {/* It only shows if permission is 'default' (i.e., user hasn't decided yet) */}
        {permissionStatus === 'default' && (
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" onClick={requestPermissionAndToken} aria-label="Abilita Notifiche Push">
                            <BellRing className="h-5 w-5 text-muted-foreground animate-pulse" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                        <p>Abilita Notifiche Push</p>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
        )}

        {/* In-App Notification Bell */}
        <div className="relative">
          <NotificationBell
            unreadCount={unreadCount}
            onClick={() => setShowNotifications(!showNotifications)}
          />
          
          {showNotifications && (
            <div className="fixed sm:absolute right-2 sm:right-0 top-16 sm:top-12 z-50">
              <NotificationCenter
                notifications={notifications}
                isLoading={isLoading}
                onNotificationsChange={handleNotificationsChange}
              />
            </div>
          )}
        </div>

        <span className="text-sm font-medium text-muted-foreground">{displayName}</span>
        <Button variant="ghost" size="icon" onClick={handleSignOut} aria-label="Esci">
            <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  )
}
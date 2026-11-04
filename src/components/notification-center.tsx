"use client";

import { useState } from "react";
import { Bell, Check, Trash2, Loader2 } from "lucide-react";
import { AppNotification } from "@/types/notification";
import { markNotificationAsRead, deleteNotification } from "@/lib/notifications";
import { useToast } from "@/components/ui/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface NotificationCenterProps {
  notifications: AppNotification[];
  isLoading?: boolean;
  onNotificationsChange?: () => void;
}

export function NotificationCenter({ 
  notifications, 
  isLoading = false,
  onNotificationsChange 
}: NotificationCenterProps) {
  const { toast } = useToast();
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set());

  const unreadNotifications = notifications.filter(n => !n.read);
  const readNotifications = notifications.filter(n => n.read);

  const handleMarkAsRead = async (notificationId: string) => {
    setUpdatingIds(prev => new Set(prev.add(notificationId)));
    try {
      await markNotificationAsRead(notificationId);
      toast({
        title: "Notifica letta",
        description: "Notifica contrassegnata come letta",
      });
      onNotificationsChange?.();
    } catch (error) {
      console.error("Error marking notification as read:", error);
      toast({
        variant: "destructive",
        title: "Errore",
        description: "Impossibile contrassegnare la notifica come letta",
      });
    } finally {
      setUpdatingIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(notificationId);
        return newSet;
      });
    }
  };

  const handleDelete = async (notificationId: string) => {
    setUpdatingIds(prev => new Set(prev.add(notificationId)));
    try {
      await deleteNotification(notificationId);
      toast({
        title: "Notifica eliminata",
        description: "Notifica rimossa con successo",
      });
      onNotificationsChange?.();
    } catch (error) {
      console.error("Error deleting notification:", error);
      toast({
        variant: "destructive",
        title: "Errore",
        description: "Impossibile eliminare la notifica",
      });
    } finally {
      setUpdatingIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(notificationId);
        return newSet;
      });
    }
  };

  const getNotificationIcon = (type: AppNotification['type']) => {
    switch (type) {
      case 'timeoff-request':
      case 'timeoff-approved':
      case 'timeoff-rejected':
        return '⏰';
      case 'document-assigned':
      case 'document-expiring':
      case 'document-expired':
        return '📄';
      case 'announcement':
        return '📢';
      default:
        return '🔔';
    }
  };

  const formatTime = (date: Date) => {
    const now = new Date();
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));
    
    if (diffInHours < 1) return 'Ora';
    if (diffInHours < 24) return `${diffInHours}h fa`;
    if (diffInHours < 168) return `${Math.floor(diffInHours / 24)}g fa`;
    return date.toLocaleDateString('it-IT');
  };

  if (isLoading) {
    return (
      <Card className="w-[90vw] max-w-sm max-h-96 mx-2 sm:mx-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Notifiche
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-[90vw] max-w-sm max-h-96 mx-2 sm:mx-0">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Notifiche
            {unreadNotifications.length > 0 && (
              <Badge variant="destructive" className="ml-2">
                {unreadNotifications.length}
              </Badge>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      
      <ScrollArea className="h-80">
        <CardContent className="p-0">
          {notifications.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Bell className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>Nessuna notifica</p>
            </div>
          ) : (
            <div className="space-y-1 p-1">
              {/* Unread notifications first */}
              {unreadNotifications.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onMarkAsRead={handleMarkAsRead}
                  onDelete={handleDelete}
                  isUpdating={updatingIds.has(notification.id)}
                  formatTime={formatTime}
                  getNotificationIcon={getNotificationIcon}
                />
              ))}
              
              {/* Read notifications */}
              {readNotifications.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onMarkAsRead={handleMarkAsRead}
                  onDelete={handleDelete}
                  isUpdating={updatingIds.has(notification.id)}
                  formatTime={formatTime}
                  getNotificationIcon={getNotificationIcon}
                />
              ))}
            </div>
          )}
        </CardContent>
      </ScrollArea>
    </Card>
  );
}

// Individual notification item component
function NotificationItem({ 
  notification, 
  onMarkAsRead, 
  onDelete, 
  isUpdating,
  formatTime,
  getNotificationIcon 
}: any) {
  return (
    <div className={`p-3 rounded-lg border transition-colors ${
      notification.read 
        ? 'bg-muted/50 border-muted' 
        : 'bg-blue-50 border-blue-200'
    }`}>
      <div className="flex items-start gap-3">
        <div className="text-lg mt-0.5">{getNotificationIcon(notification.type)}</div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h4 className={`font-medium text-sm ${
              notification.read ? 'text-muted-foreground' : 'text-foreground'
            }`}>
              {notification.title}
            </h4>
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {formatTime(notification.createdAt)}
            </span>
          </div>
          
          <p className={`text-sm mt-1 ${
            notification.read ? 'text-muted-foreground' : 'text-foreground'
          }`}>
            {notification.message}
          </p>
          
          <div className="flex items-center gap-1 mt-2">
            {!notification.read && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => onMarkAsRead(notification.id)}
                disabled={isUpdating}
              >
                {isUpdating ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Check className="h-3 w-3" />
                )}
                Leggi
              </Button>
            )}
            
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-destructive hover:text-destructive"
              onClick={() => onDelete(notification.id)}
              disabled={isUpdating}
            >
              {isUpdating ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="h-3 w-3" />
              )}
              Elimina
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
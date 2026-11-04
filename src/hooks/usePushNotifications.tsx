import { useState, useEffect } from 'react';
import { getMessaging, getToken, onMessage } from 'firebase/messaging';
import { doc, updateDoc, arrayUnion } from 'firebase/firestore';
import { db, app as firebaseApp } from '@/lib/firebase';
import { firebaseConfig } from '@/lib/firebase.config';
import { useAuth } from '@/app/layout';
import { useToast } from '@/components/ui/use-toast';

const VAPID_KEY = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;

/**
 * Registers the FCM service worker, passing the Firebase web config as query
 * parameters so the worker file itself contains no project-specific values.
 */
async function registerMessagingServiceWorker() {
    const params = new URLSearchParams(
        Object.entries(firebaseConfig).filter((entry): entry is [string, string] => Boolean(entry[1]))
    );
    return navigator.serviceWorker.register(`/firebase-messaging-sw.js?${params.toString()}`, {
        scope: '/firebase-cloud-messaging-push-scope',
    });
}

export function usePushNotifications() {
    // const { user, userProfile } = useAuth();
    const { user } = useAuth();
    const { toast } = useToast();
    // This state will let us know if we should show the "Enable Notifications" button or not
    const [permissionStatus, setPermissionStatus] = useState<NotificationPermission | null>(null);

    // This effect runs once to check the initial permission status
    useEffect(() => {
        if (typeof window !== 'undefined' && 'Notification' in window) {
            setPermissionStatus(Notification.permission);
        }
    }, []);

    // This effect handles what to do when a notification comes in while the app is active
    useEffect(() => {
        // Ensure this only runs on the client-side
        if (typeof window === 'undefined') return;

        const messaging = getMessaging(firebaseApp);
        
        const unsubscribe = onMessage(messaging, (payload) => {
            console.log('Foreground message received.', payload);
            
            // Show a toast notification to the user
            toast({
                title: payload.notification?.title || "Nuova Notifica",
                description: payload.notification?.body || "",
            });
        });

        return () => unsubscribe();
    }, [toast]);

    const requestPermissionAndToken = async () => {
        if (!user) {
            toast({ variant: "destructive", title: "Errore", description: "Devi essere autenticato per abilitare le notifiche." });
            return;
        }

        // Check if permission is already granted or denied
        if (Notification.permission === 'granted') {
            toast({ title: "Notifiche già attive", description: "Hai già abilitato le notifiche push." });
            return;
        }
        if (Notification.permission === 'denied') {
            toast({ variant: "destructive", title: "Notifiche Bloccate", description: "Hai bloccato le notifiche. Dovrai riattivarle nelle impostazioni del tuo browser." });
            return;
        }

        if (!VAPID_KEY) {
            toast({ variant: "destructive", title: "Notifiche non configurate", description: "Le notifiche push non sono disponibili in questa installazione." });
            return;
        }

        try {
            const messaging = getMessaging(firebaseApp);
            const serviceWorkerRegistration = await registerMessagingServiceWorker();

            // Get the token. This will trigger the permission request pop-up.
            const currentToken = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration });
            
            if (currentToken) {
                console.log('FCM Token obtained:', currentToken);
                
                // Save the new token to the user's document in Firestore.
                // We use arrayUnion to add the token to a list, preventing duplicates
                // and allowing a user to have notifications on multiple devices.
                const userDocRef = doc(db, 'users', user.uid);
                await updateDoc(userDocRef, {
                    fcmTokens: arrayUnion(currentToken)
                });

                toast({ title: "Notifiche Abilitate!", description: "Riceverai aggiornamenti tramite notifiche push su questo dispositivo." });
                setPermissionStatus('granted');

            } else {
                // This happens if the user clicks "Block" on the permission pop-up
                console.log('No registration token available. Permission was denied.');
                toast({ variant: "destructive", title: "Notifiche Bloccate", description: "Non hai concesso il permesso per le notifiche." });
                setPermissionStatus('denied');
            }
        } catch (error) {
            console.error('An error occurred while getting token: ', error);
            setPermissionStatus('denied'); // Assume denial on error
            toast({ variant: "destructive", title: "Errore", description: "Impossibile abilitare le notifiche." });
        }
    };

    return { permissionStatus, requestPermissionAndToken };
}
import { 
  collection, 
  addDoc, 
  query, 
  where, 
  orderBy, 
  updateDoc, 
  doc,
  deleteDoc 
} from 'firebase/firestore';
import { db } from './firebase';
import { AppNotification } from '@/types/notification';

/**
 * Create a new notification in Firestore
 */
export async function createNotification(
  notification: Omit<AppNotification, 'id' | 'createdAt'>
): Promise<string> {
  try {
    const docRef = await addDoc(collection(db, 'notifications'), {
      ...notification,
      createdAt: new Date(),
      read: false
    });
    return docRef.id;
  } catch (error) {
    console.error('Error creating notification:', error);
    throw error;
  }
}

/**
 * Get real-time query for user's notifications
 */
export function getUserNotificationsQuery(userId: string) {
  return query(
    collection(db, 'notifications'),
    where('userId', '==', userId),
    orderBy('createdAt', 'desc') // Newest first
  );
}

/**
 * Mark a notification as read
 */
export async function markNotificationAsRead(notificationId: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'notifications', notificationId), {
      read: true
    });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    throw error;
  }
}

/**
 * Mark all user notifications as read
 */
export async function markAllNotificationsAsRead(userId: string): Promise<void> {
  try {
    // This would be more efficient with a batched write
    // For now, we'll implement this in the component
    console.log('Mark all as read for user:', userId);
    // We'll implement this fully in the UI component
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    throw error;
  }
}

/**
 * Delete a notification
 */
export async function deleteNotification(notificationId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'notifications', notificationId));
  } catch (error) {
    console.error('Error deleting notification:', error);
    throw error;
  }
}

/**
 * Get unread notifications count query
 */
export function getUnreadNotificationsQuery(userId: string) {
  return query(
    collection(db, 'notifications'),
    where('userId', '==', userId),
    where('read', '==', false)
  );
}
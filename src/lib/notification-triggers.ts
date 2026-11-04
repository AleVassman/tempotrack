import { createNotification } from './notifications';
import { AppNotification, NotificationType } from '@/types/notification';

/**
 * Notify relevant admins when a user submits a time-off request
 */
export async function notifyTimeOffRequestCreated(
  request: {
    id: string;
    userId: string;
    userName: string;
    days: number;
    startDate: string;
    endDate: string;
    type: string;
    department?: string;
  },
  adminUserIds: string[]  // You'll get these from your existing admin logic
): Promise<void> {
  for (const adminId of adminUserIds) {
    await createNotification({
      userId: adminId,
      type: 'timeoff-request',
      title: 'Nuova richiesta permesso',
      message: `${request.userName} ha richiesto ${request.days} giorno${request.days !== 1 ? 'i' : ''} di ${request.type} (${request.startDate} - ${request.endDate})`,
      relatedId: request.id,
      actionUrl: `/time-off`,  // Link to time-off page
      read: false  // ← ADD THIS
    });
  }
}

/**
 * Notify user when their time-off request is approved/rejected
 */
export async function notifyTimeOffRequestUpdated(
  request: {
    id: string;
    userId: string;
    userName: string;
    days: number;
    type: string;
    status: 'Approvato' | 'Rifiutato';
  }
): Promise<void> {
  await createNotification({
    userId: request.userId,
    type: request.status === 'Approvato' ? 'timeoff-approved' : 'timeoff-rejected',
    title: `Richiesta permesso ${request.status.toLowerCase()}`,
    message: `La tua richiesta per ${request.days} giorno${request.days !== 1 ? 'i' : ''} di ${request.type} è stata ${request.status.toLowerCase()}`,
    relatedId: request.id,
    actionUrl: `/time-off`,  // Link to user's time-off page
    read: false  // ← ADD THIS
  });
}

/**
 * Notify user when a document is assigned to them
 */
export async function notifyDocumentAssigned(
  // document: {
  //   id: string;
  //   title: string;
  //   assignedToUserId: string;
  //   assignedToUserName: string;
  //   assignedByUserName: string;
  // }
): Promise<void> {
  // await createNotification({
  //   userId: document.assignedToUserId,
  //   type: 'document-assigned',
  //   title: 'Nuovo documento assegnato',
  //   message: `${document.assignedByUserName} ti ha assegnato il documento: "${document.title}"`,
  //   relatedId: document.id,
  //   actionUrl: `/documents`,  // Link to documents page
  //   read: false  // ← ADD THIS
  // });
}

/**
 * Notify user when their document is expiring soon
 */
export async function notifyDocumentExpiring(
  // document: {
  //   id: string;
  //   title: string;
  //   userId: string;
  //   userName: string;
  //   daysUntilExpiration: number;
  // }
): Promise<void> {
  // const daysText = document.daysUntilExpiration === 0 ? 'oggi' : `tra ${document.daysUntilExpiration} giorno${document.daysUntilExpiration !== 1 ? 'i' : ''}`;
  
  // await createNotification({
  //   userId: document.userId,
  //   type: 'document-expiring',
  //   title: 'Documento in scadenza',
  //   message: `Il documento "${document.title}" scade ${daysText}`,
  //   relatedId: document.id,
  //   actionUrl: `/documents`,  // Link to documents page
  //   read: false  // ← ADD THIS
  // });
}

/**
 * Notify user/HR when a document has expired
 */
export async function notifyDocumentExpired(
  // document: {
  //   id: string;
  //   title: string;
  //   userId: string;
  //   userName: string;
  //   daysSinceExpiration: number;
  // },
  // notifyHr: boolean = false,
  // hrUserIds: string[] = []  // HR users to notify
): Promise<void> {
  // Notify the document owner
  // await createNotification({
  //   userId: document.userId,
  //   type: 'document-expired',
  //   title: 'Documento scaduto',
  //   message: `Il documento "${document.title}" è scaduto ${document.daysSinceExpiration === 0 ? 'oggi' : `da ${document.daysSinceExpiration} giorno${document.daysSinceExpiration !== 1 ? 'i' : ''}`}`,
  //   relatedId: document.id,
  //   actionUrl: `/documents`,
  //   read: false  // ← ADD THIS
  // });

  // // Also notify HR if requested
  // if (notifyHr && hrUserIds.length > 0) {
  //   for (const hrId of hrUserIds) {
  //     await createNotification({
  //       userId: hrId,
  //       type: 'document-expired',
  //       title: 'Documento scaduto',
  //       message: `Il documento "${document.title}" di ${document.userName} è scaduto`,
  //       relatedId: document.id,
  //       actionUrl: `/documents`,
  //       read: false  // ← ADD THIS
  //     });
  //   }
  // }
}

/**
 * Send general announcement to multiple users
 */
export async function notifyAnnouncement(
  title: string,
  message: string,
  targetUserIds: string[]
): Promise<void> {
  for (const userId of targetUserIds) {
    await createNotification({
      userId: userId,
      type: 'announcement',
      title: title,
      message: message,
      actionUrl: '/',  // Link to dashboard
      read: false  // ← ADD THIS
    });
  }
}
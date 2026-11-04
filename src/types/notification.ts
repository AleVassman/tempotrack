export type NotificationType = 
  | 'timeoff-request'      // New time-off request submitted
  | 'timeoff-approved'     // Time-off request approved  
  | 'timeoff-rejected'     // Time-off request rejected
  | 'document-assigned'    // New document assigned to user
  | 'document-expiring'    // Document expiring soon (warning)
  | 'document-expired'     // Document has expired (urgent)
  | 'announcement'         // General announcement from HR

export interface AppNotification {
  id: string;
  userId: string;          // Who should receive this notification
  type: NotificationType;
  title: string;
  message: string;
  relatedId?: string;      // ID of related item (request, document, etc.)
  read: boolean;
  createdAt: Date;
  // Optional: for future push notifications
  actionUrl?: string;      // URL to navigate when clicked
}
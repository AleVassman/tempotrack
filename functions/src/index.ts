import {onDocumentUpdated, onDocumentCreated} from "firebase-functions/v2/firestore";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {initializeApp} from "firebase-admin/app";
import {getMessaging} from "firebase-admin/messaging";
import {getFirestore, FieldValue} from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {getAuth} from "firebase-admin/auth";


// Standard initialization.
initializeApp();

// Public URL of the deployed web app, used for notification icons/links and
// CORS. Set it in functions/.env (see functions/.env.example).
const APP_URL = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
const CORS_ORIGINS = Array.from(new Set([APP_URL, "http://localhost:3000"]));

// Define the constant directly in this file.
const TIME_OFF_STATUS = {
  PENDING: "In Sospeso",
  APPROVED: "Approvato",
  REJECTED: "Rifiutato",
} as const;

// --- NOTIFICATIONS TO USERS (DECISIONS) ---

/**
 * 1. PUSH NOTIFICATION when a time-off request is approved or rejected.
 */
export const onTimeOffRequestUpdate = onDocumentUpdated(
  {
    document: "timeOffRequests/{requestId}",
    region: "europe-west1",
  },
  async (event) => {
    if (!event.data) {
      logger.error("No data in onTimeOffRequestUpdate event.");
      return;
    }

    const beforeData = event.data.before.data();
    const afterData = event.data.after.data();

    if (
      beforeData.status === "In Sospeso" &&
      (afterData.status === "Approvato" || afterData.status === "Rifiutato")
    ) {
      logger.info(`Time-off request ${event.params.requestId} status changed to ${afterData.status}.`);
      const userId = afterData.userId;
      if (!userId) {
        logger.error("No userId found on request.");
        return;
      }

      const userDoc = await getFirestore().collection("users").doc(userId).get();
      if (!userDoc.exists) {
        logger.error(`User ${userId} not found.`);
        return;
      }

      const tokens = userDoc.data()?.fcmTokens;
      if (!tokens || !Array.isArray(tokens) || tokens.length === 0) {
        logger.info(`User ${userId} has no push tokens.`);
        return;
      }

      const statusText = afterData.status === "Approvato" ? "approvata" : "rifiutata";
      const requestType = afterData.type || "permesso";
      const payload = {
        data: {
          title: "Aggiornamento Richiesta Permesso",
          body: `La tua richiesta di ${requestType} è stata ${statusText}.`,
          icon: `${APP_URL}/icons/icon-192x192.png`,
        },
        webpush: {
          fcm_options: {
            link: `${APP_URL}/time-off`,
          },
        },
      };
      // FIXED: Pass the userId to the helper function
      await sendPushNotification(tokens, payload, userId);
    }
  }
);

/**
 * 2. PUSH NOTIFICATION when a compensatory move request is approved or rejected.
 */
export const onCompensatoryMoveRequestUpdate = onDocumentUpdated(
  {
    document: "users/{userId}/compensatoryMoveRequests/{weekId}",
    region: "europe-west1",
  },
  async (event) => {
    if (!event.data) {
      logger.error("No data in onCompensatoryMoveRequestUpdate event.");
      return;
    }

    const beforeData = event.data.before.data();
    const afterData = event.data.after.data();

    if (
      beforeData.status === "pending" &&
      (afterData.status === "approved" || afterData.status === "rejected")
    ) {
      logger.info(`Move request ${event.params.weekId} status changed to ${afterData.status}.`);
      const userId = event.params.userId;

      const userDoc = await getFirestore().collection("users").doc(userId).get();
      if (!userDoc.exists) {
        logger.error(`User ${userId} not found.`);
        return;
      }

      const tokens = userDoc.data()?.fcmTokens;
      if (!tokens || !Array.isArray(tokens) || tokens.length === 0) {
        logger.info(`User ${userId} has no push tokens.`);
        return;
      }

      const statusText = afterData.status === "approved" ? "approvata" : "rifiutata";
      const payload = {
        data: {
          title: "Aggiornamento Spostamento Recupero",
          body: `La tua richiesta di spostamento recupero per la settimana ${event.params.weekId} è stata ${statusText}.`,
          icon: `${APP_URL}/icons/icon-192x192.png`,
        },
        webpush: {
          fcm_options: {
            link: `${APP_URL}/timesheets`,
          },
        },
      };
      // FIXED: Pass the userId to the helper function
      await sendPushNotification(tokens, payload, userId);
    }
  }
);


// --- NOTIFICATIONS TO ADMINS/HR (NEW TASKS) ---

/**
 * 3. PUSH NOTIFICATION when a NEW time-off request is created.
 */
export const onTimeOffRequestCreate = onDocumentCreated(
  {
    document: "timeOffRequests/{requestId}",
    region: "europe-west1",
  },
  async (event) => {
    if (!event.data) {
      logger.error("No data in onTimeOffRequestCreate event.");
      return;
    }
    const newRequest = event.data.data();
    logger.info(`New time-off request ${event.params.requestId} created.`);
    const payload = {
      data: {
        title: "Nuova Richiesta di Permesso",
        body: `Hai una nuova richiesta da ${newRequest.userName || "un utente"}.`,
        icon: `${APP_URL}/icons/icon-192x192.png`,
      },
      webpush: {
        fcm_options: {
          link: `${APP_URL}/`,
        },
      },
    };

    await notifyAdminsAndHr(newRequest.department, payload);
  }
);

/**
 * 4. PUSH NOTIFICATION when a NEW compensatory move request is created.
 */
export const onCompensatoryMoveRequestCreate = onDocumentCreated(
  {
    document: "users/{userId}/compensatoryMoveRequests/{weekId}",
    region: "europe-west1",
  },
  async (event) => {
    if (!event.data) {
      logger.error("No data in onCompensatoryMoveRequestCreate event.");
      return;
    }
    const newRequest = event.data.data();
    logger.info(`New move request ${event.params.weekId} created by ${newRequest.userName}.`);

    const userDoc = await getFirestore().collection("users").doc(newRequest.userId).get();
    const department = userDoc.exists ? userDoc.data()?.department : null;

    const payload = {
      data: {
        title: "Nuova Richiesta Spostamento Recupero",
        body: `Hai una nuova richiesta da ${newRequest.userName || "un utente"}.`,
        icon: `${APP_URL}/icons/icon-192x192.png`,
      },
      webpush: {
        fcm_options: {
          link: `${APP_URL}/`,
        },
      },
    };

    await notifyAdminsAndHr(department, payload);
  }
);


// --- HELPER FUNCTIONS ---

/**
 * A reusable helper function to send push notifications and handle errors.
 * @param {string[]} tokens An array of FCM tokens.
 * @param {object} payload The notification payload.
 * @param {string} [userId] Optional userId for cleaning up invalid tokens.
 */
async function sendPushNotification(tokens: string[], payload: object, userId?: string) {
  try {
    const response = await getMessaging().sendEachForMulticast({
      tokens: tokens,
      ...payload,
    });
    logger.info(`${response.successCount} messages were sent successfully`);

    if (response.failureCount > 0) {
      const tokensToDelete: string[] = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const error = resp.error;
          logger.error(`Token ${tokens[idx]} failed with error:`, error);
          // ADDED: Check if the error object exists before accessing its properties
          if (error) {
            // Check for the specific error codes that mean a token is invalid
            if (error.code === "messaging/registration-token-not-registered" ||
                error.code === "messaging/invalid-registration-token") {
              tokensToDelete.push(tokens[idx]);
            }
          }
        }
      });

      // FIXED: Check for userId before attempting to clean up tokens
      if (tokensToDelete.length > 0 && userId) {
        logger.info(`Cleaning up ${tokensToDelete.length} invalid tokens for user ${userId}`);
        const userRef = getFirestore().collection("users").doc(userId);
        await userRef.update({
          fcmTokens: FieldValue.arrayRemove(...tokensToDelete),
        });
      }
    }
  } catch (error) {
    logger.error("Error sending multicast message:", error);
  }
}

/**
 * Finds all relevant HR and Admin tokens and sends them a notification.
 * @param {string | null} department The department to find relevant admins for.
 * @param {object} payload The notification payload to send.
 */
async function notifyAdminsAndHr(department: string | null, payload: object) {
  const db = getFirestore();
  const tokensToSend = new Set<string>();

  // This map will store userId associated with each token for potential cleanup
  const tokenUserMap = new Map<string, string>();

  // 1. Get HR tokens
  try {
    const hrSnapshot = await db.collection("users").where("role", "==", "hr").get();
    hrSnapshot.forEach((doc) => {
      doc.data()?.fcmTokens?.forEach((token: string) => {
        tokensToSend.add(token);
        tokenUserMap.set(token, doc.id); // Map token to userId
      });
    });
  } catch (error) {
    logger.error("Error fetching HR tokens:", error);
  }

  // 2. Get Admin tokens
  if (department) {
    try {
      const adminSnapshot = await db.collection("users").where("role", "==", "admin").where("managedDepartments", "array-contains", department).get();
      adminSnapshot.forEach((doc) => {
        doc.data()?.fcmTokens?.forEach((token: string) => {
          tokensToSend.add(token);
          tokenUserMap.set(token, doc.id); // Map token to userId
        });
      });
    } catch (error) {
      logger.error("Error fetching admin tokens:", error);
    }
  }

  // 3. Send notifications
  if (tokensToSend.size > 0) {
    const uniqueTokens = Array.from(tokensToSend);
    logger.info(`Notifying ${uniqueTokens.length} admin/HR tokens.`);
    // FIXED: We don't have a single userId, so we pass undefined for the cleanup parameter.
    // A more advanced (but complex) version could clean up tokens for multiple users.
    await sendPushNotification(uniqueTokens, payload, undefined);
  } else {
    logger.warn("Found no admin/HR tokens to send notifications to.");
  }
}

/**
 * A scheduled function that runs at 02:00 on the 10th day of every month.
 * It ARCHIVES all timeOffRequests and notifications that are fully completed
 * and occurred in months prior to the current one.
 */
export const monthlyJanitor = onSchedule("0 2 10 1 *", async () => {
    logger.info("Running monthly janitor function to ARCHIVE old documents...");

    const now = new Date();
    // Set the cutoff to the first day of the CURRENT month at midnight.
    // Any request that ENDED before this date is safe to archive.
    // const cutoffDate = new Date(now.getFullYear(), now.getMonth(), 1);
    const cutoffDate = new Date(now.getFullYear() - 1, now.getMonth(), 1);
    const formattedCutoffDate = cutoffDate.toISOString().split("T")[0]; // "YYYY-MM-DD"

    logger.info(`Targeting documents that ended before ${formattedCutoffDate}`);

    const db = getFirestore();
    let totalArchivedCount = 0;

    // --- 1. Archive old and COMPLETED Time-Off Requests ---
    try {
      // CORRECTED LOGIC: Query for requests where the END DATE is before the start of this month.
      const oldTimeOffQuery = db.collection("timeOffRequests")
        .where("endDate", "<", formattedCutoffDate);

      const snapshot = await oldTimeOffQuery.get();
      if (snapshot.empty) {
        logger.info("No old, completed time-off requests found to archive.");
      } else {
        const batch = db.batch();
        snapshot.forEach((doc) => {
          const archiveRef = db.collection("archive_timeOffRequests").doc(doc.id);
          batch.set(archiveRef, doc.data());
          batch.delete(doc.ref);
        });
        await batch.commit();
        totalArchivedCount += snapshot.size;
        logger.info(`Successfully ARCHIVED ${snapshot.size} old time-off requests.`);
      }
    } catch (error) {
      logger.error("Error archiving old time-off requests:", error);
    }

    // --- 2. Archive old In-App Notifications ---
    // For notifications, using 'createdAt' is safe, as they are not "active" in the future.
    try {
      const oldNotificationsQuery = db.collection("notifications")
        .where("createdAt", "<", cutoffDate);

      const snapshot = await oldNotificationsQuery.get();
      if (snapshot.empty) {
        logger.info("No old notifications found to archive.");
      } else {
        const batch = db.batch();
        snapshot.forEach((doc) => {
          const archiveRef = db.collection("archive_notifications").doc(doc.id);
          batch.set(archiveRef, doc.data());
          batch.delete(doc.ref);
        });
        await batch.commit();
        totalArchivedCount += snapshot.size;
        logger.info(`Successfully ARCHIVED ${snapshot.size} old notifications.`);
      }
    } catch (error) {
      logger.error("Error archiving old notifications:", error);
    }

    // Logic for Compensatory Move Requests is still omitted for simplicity but
    // would also need a date-based check on the weekId.

    logger.info(`Monthly janitor finished. A total of ${totalArchivedCount} documents were archived.`);
  }
);

export const createUser = onCall({cors: CORS_ORIGINS}, async (request) => {
  // 1. Authentication Check: Ensure the user calling this function is an authenticated HR user.
  if (request.auth?.token.role !== "hr") {
    logger.error("User without HR role attempted to create a user.", {uid: request.auth?.uid});
    throw new HttpsError("permission-denied", "Solo gli utenti HR possono creare nuovi utenti.");
  }

  // 2. Data Validation: Ensure all required data was sent from the client.
  const {email, password, firstName, lastName, department, role} = request.data;
  if (!email || !password || !firstName || !lastName || !department || !role) {
    throw new HttpsError("invalid-argument", "Mancano alcuni dati obbligatori.");
  }

  const {contactEmail, cellphone} = request.data;

  try {
    logger.info(`Attempting to create user: ${email}`);

    // 3. Create User in Firebase Authentication
    const userRecord = await getAuth().createUser({
      email: email,
      password: password,
      displayName: `${firstName} ${lastName}`,
    });

    // 4. Set Custom Claims (this is how we assign roles)
    await getAuth().setCustomUserClaims(userRecord.uid, {role: role});

    // 5. Create User Profile in Firestore
    const userDocRef = getFirestore().collection("users").doc(userRecord.uid);
    await userDocRef.set({
      firstName,
      lastName,
      email,
      department,
      role,
      contactEmail: contactEmail || "",
      cellphone: cellphone || "",
      status: "active",
      workSchedule: [],
      managedDepartments: [],
    });

    logger.info(`Successfully created user ${userRecord.uid} with email ${email}`);
    return {success: true, uid: userRecord.uid};
  } catch (error: any) {
    logger.error("Error creating new user:", error);
    // Provide a user-friendly error message back to the client
    if (error.code === "auth/email-already-exists") {
      throw new HttpsError("already-exists", "Questa email è già in uso da un altro account.");
    }
    throw new HttpsError("internal", "Si è verificato un errore imprevisto durante la creazione dell'utente.");
  }
});

/**
 * Cloud Function that triggers when a new timeOffRequest is created.
 * Its purpose is to check for and delete any smaller, pre-existing requests
 * that are fully contained within the new request's date range.
 */
export const onTimeOffRequestCreateUpgrade = onDocumentCreated(
  {
    document: "timeOffRequests/{requestId}",
    region: "europe-west1",
  },
  async (event) => {
    const newRequest = event.data?.data();
    const newRequestId = event.params.requestId;

    if (!newRequest || !newRequest.userId || !newRequest.startDate || !newRequest.endDate) {
      logger.info(`[${newRequestId}] Document created without essential data. Exiting function.`);
      return;
    }

    logger.info(`[${newRequestId}] New time-off request created for user: ${newRequest.userId}`);
    logger.info(`[${newRequestId}] Date Range: ${newRequest.startDate} to ${newRequest.endDate}`);

    const userId = newRequest.userId;
    const newStartDate = newRequest.startDate;
    const newEndDate = newRequest.endDate;

    const db = getFirestore(); // Get the Firestore instance
    const containedRequestsQuery = db.collection("timeOffRequests")
      .where("userId", "==", userId)
      .where("status", "in", [TIME_OFF_STATUS.PENDING, TIME_OFF_STATUS.APPROVED])
      .where("startDate", ">=", newStartDate)
      .where("endDate", "<=", newEndDate);

    try {
      const querySnapshot = await containedRequestsQuery.get();

      if (querySnapshot.size <= 1) {
        logger.info(`[${newRequestId}] No smaller, contained requests found to delete.`);
      } else {
        logger.warn(`[${newRequestId}] Found ${querySnapshot.size - 1} older request(s) to upgrade/delete.`);

        // --- THIS IS THE NEW DELETION LOGIC ---

        // 1. Create a new batch write.
        const batch = db.batch();
        let deletionCount = 0;

        // 2. Loop through the results.
        querySnapshot.forEach((doc) => {
          // IMPORTANT: Only delete documents that are NOT the one that triggered this function.
          if (doc.id !== newRequestId) {
            logger.info(`[${newRequestId}] Deleting older, contained request: ${doc.id}`);
            batch.delete(doc.ref); // Add the delete operation to the batch.
            deletionCount++;
          }
        });

        // 3. If there's anything in the batch, commit it to the database.
        if (deletionCount > 0) {
          await batch.commit();
          logger.info(`[${newRequestId}] Successfully deleted ${deletionCount} older request(s).`);
        }
        // --- END OF NEW DELETION LOGIC ---
      }
    } catch (error) {
      logger.error(`[${newRequestId}] Error during the upgrade/delete process:`, error);
    }

    logger.info(`[${newRequestId}] Function finished processing.`);
    return;
  }
);

export const deleteUser = onCall({cors: CORS_ORIGINS}, async (request) => {
  // 1. --- SECURITY CHECK ---
  // Ensure the user calling this function is an authenticated HR user.
  if (request.auth?.token.role !== "hr") {
    logger.error("User without HR role attempted to delete a user.", {
      callerUid: request.auth?.uid,
    });
    throw new HttpsError("permission-denied", "Solo gli utenti HR possono eliminare altri utenti.");
  }

  // 2. --- DATA VALIDATION ---
  const userIdToDelete = request.data.userId;
  if (!userIdToDelete) {
    throw new HttpsError("invalid-argument", "ID utente non fornito.");
  }

  // Safety check to prevent an HR user from deleting themselves by accident via this function
  if (request.auth?.uid === userIdToDelete) {
    throw new HttpsError("permission-denied", "Non è possibile eliminare il proprio account tramite questa funzione.");
  }

  logger.info(`Attempting to delete user: ${userIdToDelete}, initiated by HR user: ${request.auth?.uid}`);

  try {
    // 3. --- DELETE FROM AUTHENTICATION ---
    // This is irreversible and revokes their ability to log in.
    await getAuth().deleteUser(userIdToDelete);
    logger.info(`Successfully deleted user ${userIdToDelete} from Firebase Authentication.`);

    // 4. --- "SOFT DELETE" IN FIRESTORE ---
    // Instead of deleting the document, we update it to mark as deleted.
    const userDocRef = getFirestore().collection("users").doc(userIdToDelete);
    await userDocRef.update({
      status: "deleted",
      deletedAt: FieldValue.serverTimestamp(),
      // We can also clear sensitive/personal data if required by privacy rules
      contactEmail: FieldValue.delete(),
      cellphone: FieldValue.delete(),
    });
    logger.info(`Successfully soft-deleted user ${userIdToDelete} in Firestore.`);

    return {success: true, message: `User ${userIdToDelete} has been deleted.`};
  } catch (error: any) {
    logger.error(`Error deleting user ${userIdToDelete}:`, error);
    // Provide a useful error message back to the client
    if (error.code === "auth/user-not-found") {
      throw new HttpsError("not-found", "Utente non trovato in Firebase Authentication.");
    }
    throw new HttpsError("internal", "Si è verificato un errore imprevisto durante l'eliminazione dell'utente.");
  }
});

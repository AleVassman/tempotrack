import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from './firebase';

/**
 * Find admin users who should be notified about a time-off request
 * Based on the requesting user's department
 */
export async function getRelevantAdmins(requestingUserId: string): Promise<string[]> {
  try {
    // First, get the requesting user's department
    const userDoc = await getDocs(
      query(collection(db, "users"), where("__name__", "==", requestingUserId))
    );
    
    if (userDoc.empty) {
      console.log("User not found:", requestingUserId);
      return [];
    }
    
    const userData = userDoc.docs[0].data();
    const userDepartment = userData.department;
    
    if (!userDepartment) {
      console.log("User has no department assigned");
      return [];
    }
    
    // Find admins who manage this department
    const adminsQuery = query(
      collection(db, "users"),
      where("role", "in", ["admin", "hr"]),
      where("managedDepartments", "array-contains", userDepartment)
    );
    
    const adminsSnapshot = await getDocs(adminsQuery);
    const adminIds = adminsSnapshot.docs.map(doc => doc.id);
    
    console.log(`Found ${adminIds.length} admins for department ${userDepartment}`);
    return adminIds;
    
  } catch (error) {
    console.error("Error finding relevant admins:", error);
    return [];
  }
}

/**
 * Get all HR users (for fallback)
 */
export async function getAllHrUsers(): Promise<string[]> {
  try {
    const hrQuery = query(collection(db, "users"), where("role", "==", "hr"));
    const hrSnapshot = await getDocs(hrQuery);
    return hrSnapshot.docs.map(doc => doc.id);
  } catch (error) {
    console.error("Error finding HR users:", error);
    return [];
  }
}
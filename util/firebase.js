import admin from 'firebase-admin';
import fs from 'fs';


let db = null;

export const initializeFirestore = async () => {
    const serviceAccount = JSON.parse(fs.readFileSync(new URL('../serviceAccountKey.json', import.meta.url)));
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });

    admin.firestore().settings({ ignoreUndefinedProperties: true });
    db = admin.firestore();
    console.log('Firestore initialized: ', db.projectId);
}

export const getFirestoreDB = () => {
    if (!db) {
        throw new Error('Firestore not initialized');
    }
    return db;
}


export async function sendPushNotification(messageBody) {
    let db = getFirestoreDB();
    const userRef = db.collection('users').where('outletId' , '==', messageBody.outletId);
    const userSnapshot = await userRef.get();
    let deviceTokens = [];
    let orderStatus = `Order ${messageBody.orderId} status updated to ${messageBody.orderStatus}`;
    if (!userSnapshot.empty) {
      userSnapshot.forEach(user => {
        let userData = user.data();
        if(userData.fcmToken) {
            //collect all fcmTokens
            deviceTokens.push(userData.fcmToken);
        }
      });
    }

    if (deviceTokens.length === 0) {
        console.log("No device tokens found for the given outletId:", messageBody.outletId);
        return;
    }

    const multicastMessage = {
        notification: "Order Update", // Copy notification payload
        data: orderStatus, 
        tokens: deviceTokens  // Array of registration tokens
    };

    try {
        const response = await admin.messaging().sendEachForMulticast(multicastMessage);
        console.log("Successfully sent:", response.successCount);
        if (response.failureCount > 0) {
            console.warn("Failed tokens:", response.responses
                .map((r, idx) => r.success ? null : deviceTokens[idx])
                .filter(Boolean));
        }
    } catch (err) {
        console.error("FCM error:", err);
    }
}
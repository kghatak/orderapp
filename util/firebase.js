import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

let db = null;
let firebaseEnv = null;

const resolveFirebaseEnv = () => {
    const explicit = (process.env.FIREBASE_ENV || '').trim().toLowerCase();
    if (explicit === 'test' || explicit === 'production') {
        return explicit;
    }
    const nodeEnv = (process.env.NODE_ENV || '').trim().toLowerCase();
    if (nodeEnv === 'development' || nodeEnv === 'testing' || nodeEnv === 'test') {
        return 'test';
    }
    return 'production';
};

const resolveServiceAccountPath = (env) => {
    const relativePath = env === 'test'
        ? (process.env.FIREBASE_TEST_SERVICE_ACCOUNT_PATH || 'serviceAccountKey.test.json')
        : (process.env.FIREBASE_SERVICE_ACCOUNT_PATH || 'serviceAccountKey.json');
    return path.isAbsolute(relativePath) ? relativePath : path.join(projectRoot, relativePath);
};

export const initializeFirestore = async () => {
    firebaseEnv = resolveFirebaseEnv();
    const serviceAccountPath = resolveServiceAccountPath(firebaseEnv);

    if (!fs.existsSync(serviceAccountPath)) {
        throw new Error(
            `Firebase service account not found for FIREBASE_ENV=${firebaseEnv}: ${serviceAccountPath}`
        );
    }

    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });

    admin.firestore().settings({ ignoreUndefinedProperties: true });
    db = admin.firestore();
    console.log(
        `Firestore initialized: ${serviceAccount.project_id} (FIREBASE_ENV=${firebaseEnv})`
    );
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
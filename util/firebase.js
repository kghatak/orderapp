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

export async function createInboxNotification({
    userId,
    title,
    body,
    type = 'order',
    orderId = '',
    outletId = '',
    returnId = '',
}) {
    if (!userId) return;
    try {
        const firestore = getFirestoreDB();
        await firestore.collection('notifications').add({
            userId,
            title,
            body,
            type,
            orderId: String(orderId || ''),
            returnId: String(returnId || ''),
            outletId: String(outletId || ''),
            isRead: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log('[API] inbox notification userId=' + userId + ' type=' + type + ' title=' + title);
    } catch (err) {
        console.error('[API] inbox notification failed:', err);
    }
}


export async function sendPushNotification(messageBody) {
    const db = getFirestoreDB();
    const status = messageBody.status || messageBody.orderStatus || '';
    const userSnapshot = await db.collection('users')
      .where('outletId', '==', messageBody.outletId)
      .get();

    const tokenUsers = [];
    userSnapshot.forEach((user) => {
      const token = user.data()?.fcmToken;
      if (token) {
        tokenUsers.push({ ref: user.ref, token });
      }
    });

    if (tokenUsers.length === 0) {
        console.log("No device tokens found for the given outletId:", messageBody.outletId);
        return;
    }

    const deviceTokens = tokenUsers.map((row) => row.token);
    const multicastMessage = {
        tokens: deviceTokens,
        notification: {
          title: 'Order Update',
          body: `Order ${messageBody.orderId} status updated to ${status}`,
        },
        data: {
          orderId: String(messageBody.orderId || ''),
          status: String(status),
          outletId: String(messageBody.outletId || ''),
        },
    };

    try {
        const response = await admin.messaging().sendEachForMulticast(multicastMessage);
        console.log('[API] FCM sent success=' + response.successCount + ' fail=' + response.failureCount + ' outletId=' + messageBody.outletId);
        if (response.failureCount > 0) {
            const deadCodes = new Set([
              'messaging/registration-token-not-registered',
              'messaging/invalid-registration-token',
            ]);
            const staleRefs = [];
            response.responses.forEach((result, idx) => {
              if (result.success) return;
              const code = result.error?.code;
              console.warn('FCM token failed:', deviceTokens[idx], code || result.error?.message);
              if (code && deadCodes.has(code)) {
                staleRefs.push(tokenUsers[idx].ref);
              }
            });
            await Promise.all(
              staleRefs.map((ref) => ref.update({ fcmToken: '', updatedAt: new Date() })),
            );
        }
    } catch (err) {
        console.error("FCM error:", err);
    }
}

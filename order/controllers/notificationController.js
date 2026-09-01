import { getFirestoreDB } from '../../util/firebase.js';

export const getNotifications = async (req, res) => {
  try {
    const { userId, unreadOnly } = req.query;
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const db = getFirestoreDB();
    let query = db.collection('notifications').where('userId', '==', userId);
    if (unreadOnly === 'true') {
      query = query.where('isRead', '==', false);
    }

    const snapshot = await query.get();
    const notifications = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => {
        const aTime = a.createdAt?.toDate?.()?.getTime?.() || a.createdAt?._seconds || 0;
        const bTime = b.createdAt?.toDate?.()?.getTime?.() || b.createdAt?._seconds || 0;
        return bTime - aTime;
      });

    res.status(200).json(notifications);
    if (unreadOnly !== 'true') {
      console.log('[API] GET /notifications userId=' + userId + ' count=' + notifications.length);
    }
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
};

export const markNotificationRead = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const id = req.params.id;
    await db.collection('notifications').doc(id).update({ isRead: true });
    console.log('[API] PUT /notifications/' + id + '/read');
    res.status(200).json({ message: 'Notification marked as read' });
  } catch (error) {
    console.error('Error marking notification read:', error);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
};

export const markAllNotificationsRead = async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const db = getFirestoreDB();
    const snapshot = await db.collection('notifications')
      .where('userId', '==', userId)
      .where('isRead', '==', false)
      .get();

    const batch = db.batch();
    snapshot.docs.forEach((doc) => {
      batch.update(doc.ref, { isRead: true });
    });
    if (!snapshot.empty) {
      await batch.commit();
    }

    res.status(200).json({ message: 'Notifications marked as read', count: snapshot.size });
    console.log('[API] PUT /notifications/read-all userId=' + userId + ' count=' + snapshot.size);
  } catch (error) {
    console.error('Error marking all notifications read:', error);
    res.status(500).json({ error: 'Failed to mark notifications as read' });
  }
};

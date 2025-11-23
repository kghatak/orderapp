import admin from 'firebase-admin';
import { getFirestoreDB } from '../util/firebase.js';

class ChatModel {
  constructor() {
    // Don't initialize db here - Firebase might not be ready yet
    // Use getter method instead
  }

  // Lazy initialization of database connection
  get db() {
    return getFirestoreDB();
  }

  get chatsCollection() {
    return this.db.collection('chats');
  }

  get countersCollection() {
    return this.db.collection('counters');
  }

  // Generate formatted chat ID with retry logic
  async generateChatId(retries = 3) {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const counterRef = this.countersCollection.doc('chatCounter');
        
        return await this.db.runTransaction(async (transaction) => {
          const counterDoc = await transaction.get(counterRef);
          let currentCount = 1;
          
          if (counterDoc.exists) {
            currentCount = counterDoc.data().count + 1;
          }
          
          transaction.set(counterRef, { count: currentCount }, { merge: true });
          
          // Format: CHAT000001
          return `CHAT${currentCount.toString().padStart(6, '0')}`;
        });
      } catch (error) {
        console.warn(`Chat ID generation attempt ${attempt + 1} failed:`, error.message);
        if (attempt === retries - 1) {
          throw new Error(`Failed to generate chat ID after ${retries} attempts: ${error.message}`);
        }
        // Wait a bit before retrying
        await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 50));
      }
    }
  }

  // Generate formatted message ID with retry logic
  async generateMessageId(retries = 3) {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const counterRef = this.countersCollection.doc('messageCounter');
        
        return await this.db.runTransaction(async (transaction) => {
          const counterDoc = await transaction.get(counterRef);
          let currentCount = 1;
          
          if (counterDoc.exists) {
            currentCount = counterDoc.data().count + 1;
          }
          
          transaction.set(counterRef, { count: currentCount }, { merge: true });
          
          // Format: MSG00000001
          return `MSG${currentCount.toString().padStart(8, '0')}`;
        });
      } catch (error) {
        console.warn(`Message ID generation attempt ${attempt + 1} failed:`, error.message);
        if (attempt === retries - 1) {
          throw new Error(`Failed to generate message ID after ${retries} attempts: ${error.message}`);
        }
        // Wait a bit before retrying
        await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 50));
      }
    }
  }

  // Validate input data
  validateChatInput(outletId, outletName) {
    if (!outletId || typeof outletId !== 'string' || outletId.trim().length === 0) {
      throw new Error('Valid outletId is required');
    }
    if (!outletName || typeof outletName !== 'string' || outletName.trim().length === 0) {
      throw new Error('Valid outletName is required');
    }
    // Basic sanitization
    if (!/^[a-zA-Z0-9_-]+$/.test(outletId)) {
      throw new Error('outletId contains invalid characters');
    }
  }

  validateMessageInput(sender, message) {
    if (!sender || !['outlet', 'admin'].includes(sender)) {
      throw new Error('sender must be either "outlet" or "admin"');
    }
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      throw new Error('Valid message is required');
    }
    if (message.length > 1000) {
      throw new Error('Message too long (max 1000 characters)');
    }
  }

  // Get or create chat
  async getOrCreateChat(outletId, outletName) {
    try {
      this.validateChatInput(outletId, outletName);

      // Check if chat already exists for this outlet
      const existingChatQuery = await this.chatsCollection
        .where('outletId', '==', outletId.trim())
        .limit(1)
        .get();

      if (!existingChatQuery.empty) {
        const existingChat = existingChatQuery.docs[0];
        const chatData = existingChat.data();
        
        // Update outlet name if it has changed
        if (chatData.outletName !== outletName.trim()) {
          await existingChat.ref.update({
            outletName: outletName.trim(),
            updatedAt: admin.firestore.Timestamp.now()
          });
        }
        
        return {
          success: true,
          chatId: chatData.chatId,
          isNew: false
        };
      }

      // Create new chat
      const chatId = await this.generateChatId();
      const now = admin.firestore.Timestamp.now();
      
      const chatData = {
        chatId,
        outletId: outletId.trim(),
        outletName: outletName.trim(),
        lastMessage: '',
        lastMessageTime: now,
        createdAt: now,
        updatedAt: now,
        messageCount: 0
      };

      await this.chatsCollection.doc(chatId).set(chatData);

      return {
        success: true,
        chatId,
        isNew: true
      };
    } catch (error) {
      console.error('Error in getOrCreateChat:', error);
      throw error;
    }
  }

  // Send message
  async sendMessage(chatId, sender, message, outletId, outletName) {
    try {
      this.validateMessageInput(sender, message);
      this.validateChatInput(outletId, outletName);

      const messageId = await this.generateMessageId();
      const now = admin.firestore.Timestamp.now();

      // Sanitize message
      const sanitizedMessage = message.trim().substring(0, 1000);

      // Create message data
      const messageData = {
        messageId,
        sender,
        message: sanitizedMessage,
        timestamp: now,
        read: false
      };

      // Use transaction to ensure consistency
      await this.db.runTransaction(async (transaction) => {
        const chatRef = this.chatsCollection.doc(chatId);
        const chatDoc = await transaction.get(chatRef);
        
        if (!chatDoc.exists) {
          throw new Error('Chat not found');
        }

        const messagesRef = chatRef.collection('messages');
        const messageRef = messagesRef.doc(messageId);
        
        // Add message
        transaction.set(messageRef, messageData);

        // Update chat document
        const currentData = chatDoc.data();
        transaction.update(chatRef, {
          lastMessage: sanitizedMessage,
          lastMessageTime: now,
          updatedAt: now,
          outletName: outletName.trim(),
          messageCount: (currentData.messageCount || 0) + 1
        });
      });

      return {
        success: true,
        messageId
      };
    } catch (error) {
      console.error('Error in sendMessage:', error);
      throw error;
    }
  }

  // Get chat messages with cursor-based pagination
  async getChatMessages(chatId, limit = 50, before = null) {
    try {
      const chatRef = this.chatsCollection.doc(chatId);
      
      // Check if chat exists
      const chatDoc = await chatRef.get();
      if (!chatDoc.exists) {
        throw new Error('Chat not found');
      }

      let messagesQuery = chatRef.collection('messages')
        .orderBy('timestamp', 'desc')
        .limit(limit + 1); // Get one extra to check if there are more

      if (before) {
        const beforeMessageRef = chatRef.collection('messages').doc(before);
        const beforeMessageDoc = await beforeMessageRef.get();
        if (beforeMessageDoc.exists) {
          messagesQuery = messagesQuery.startAfter(beforeMessageDoc);
        }
      }

      const messagesSnapshot = await messagesQuery.get();
      const messages = [];
      let hasMore = false;

      messagesSnapshot.docs.forEach((doc, index) => {
        if (index < limit) {
          const data = doc.data();
          messages.push({
            id: doc.id,
            messageId: data.messageId,
            sender: data.sender,
            message: data.message,
            timestamp: data.timestamp.toDate(),
            read: data.read
          });
        } else {
          hasMore = true;
        }
      });

      return {
        success: true,
        data: messages,
        hasMore,
        nextCursor: messages.length > 0 ? messages[messages.length - 1].messageId : null
      };
    } catch (error) {
      console.error('Error in getChatMessages:', error);
      throw error;
    }
  }

  // Get all chats with cursor-based pagination
  async getAllChats(limit = 20, startAfter = null, sortBy = 'lastMessageTime') {
    try {
      const validSortFields = ['lastMessageTime', 'outletName', 'createdAt'];
      const sortField = validSortFields.includes(sortBy) ? sortBy : 'lastMessageTime';
      
      let chatsQuery = this.chatsCollection
        .orderBy(sortField, 'desc')
        .limit(limit + 1); // Get one extra to check if there are more

      if (startAfter) {
        const startDoc = await this.chatsCollection.doc(startAfter).get();
        if (startDoc.exists) {
          chatsQuery = chatsQuery.startAfter(startDoc);
        }
      }

      const chatsSnapshot = await chatsQuery.get();
      const chats = [];
      let hasMore = false;

      for (let i = 0; i < chatsSnapshot.docs.length; i++) {
        if (i < limit) {
          const doc = chatsSnapshot.docs[i];
          const data = doc.data();
          
          // Get unread message count
          const unreadQuery = await doc.ref.collection('messages')
            .where('read', '==', false)
            .where('sender', '==', 'outlet')
            .get();
          
          chats.push({
            id: doc.id,
            chatId: data.chatId,
            outletId: data.outletId,
            outletName: data.outletName,
            lastMessage: data.lastMessage,
            lastMessageTime: data.lastMessageTime.toDate(),
            createdAt: data.createdAt.toDate(),
            updatedAt: data.updatedAt.toDate(),
            messageCount: data.messageCount || 0,
            unreadCount: unreadQuery.size
          });
        } else {
          hasMore = true;
        }
      }

      return {
        success: true,
        data: chats,
        hasMore,
        nextCursor: chats.length > 0 ? chats[chats.length - 1].chatId : null
      };
    } catch (error) {
      console.error('Error in getAllChats:', error);
      throw error;
    }
  }

  // Mark messages as read
  async markMessagesAsRead(chatId, messageIds) {
    try {
      if (!Array.isArray(messageIds) || messageIds.length === 0) {
        throw new Error('messageIds must be a non-empty array');
      }

      const batch = this.db.batch();
      const chatRef = this.chatsCollection.doc(chatId);

      // Check if chat exists
      const chatDoc = await chatRef.get();
      if (!chatDoc.exists) {
        throw new Error('Chat not found');
      }

      messageIds.forEach(messageId => {
        const messageRef = chatRef.collection('messages').doc(messageId);
        batch.update(messageRef, { read: true });
      });

      await batch.commit();

      return {
        success: true,
        message: 'Messages marked as read'
      };
    } catch (error) {
      console.error('Error in markMessagesAsRead:', error);
      throw error;
    }
  }

  // Check if chat exists
  async chatExists(chatId) {
    try {
      if (!chatId) return false;
      const chatDoc = await this.chatsCollection.doc(chatId).get();
      return chatDoc.exists;
    } catch (error) {
      console.error('Error in chatExists:', error);
      return false;
    }
  }

  // Get chat details
  async getChatDetails(chatId) {
    try {
      const chatDoc = await this.chatsCollection.doc(chatId).get();
      
      if (!chatDoc.exists) {
        throw new Error('Chat not found');
      }

      const chatData = chatDoc.data();
      
      // Get unread message count
      const unreadQuery = await chatDoc.ref.collection('messages')
        .where('read', '==', false)
        .where('sender', '==', 'outlet')
        .get();

      return {
        success: true,
        data: {
          id: chatDoc.id,
          chatId: chatData.chatId,
          outletId: chatData.outletId,
          outletName: chatData.outletName,
          lastMessage: chatData.lastMessage,
          lastMessageTime: chatData.lastMessageTime.toDate(),
          createdAt: chatData.createdAt.toDate(),
          updatedAt: chatData.updatedAt.toDate(),
          messageCount: chatData.messageCount || 0,
          unreadCount: unreadQuery.size
        }
      };
    } catch (error) {
      console.error('Error in getChatDetails:', error);
      throw error;
    }
  }
}

export default ChatModel;
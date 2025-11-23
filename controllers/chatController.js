import ChatModel from '../models/chatModel.js';

class ChatController {
  constructor() {
    // Don't instantiate ChatModel here to avoid Firebase initialization issues
    this.chatModel = null;

    // Bind all methods to preserve 'this' context
    this.getOrCreateChat = this.getOrCreateChat.bind(this);
    this.sendMessage = this.sendMessage.bind(this);
    this.getChatMessages = this.getChatMessages.bind(this);
    this.getAllChats = this.getAllChats.bind(this);
    this.markMessagesAsRead = this.markMessagesAsRead.bind(this);
    this.getChatDetails = this.getChatDetails.bind(this);
    this.healthCheck = this.healthCheck.bind(this);
  }

  // Lazy initialization of ChatModel
  getChatModel() {
    if (!this.chatModel) {
      this.chatModel = new ChatModel();
    }
    return this.chatModel;
  }

  // Error response helper
  sendErrorResponse(res, error, defaultMessage = 'Internal server error') {
    console.error('ChatController Error:', error);
    
    const statusCode = error.statusCode || 500;
    const message = error.message || defaultMessage;
    
    return res.status(statusCode).json({
      success: false,
      message,
      ...(process.env.NODE_ENV === 'development' && { error: error.stack })
    });
  }

  // Get or create chat
  async getOrCreateChat(req, res) {
    try {
      const { outletId, outletName } = req.body;

      // Validation
      if (!outletId || !outletName) {
        return res.status(400).json({
          success: false,
          message: 'outletId and outletName are required'
        });
      }

      const chatModel = this.getChatModel();
      const result = await chatModel.getOrCreateChat(outletId, outletName);

      return res.status(200).json({
        success: true,
        chatId: result.chatId,
        message: result.isNew ? 'New chat created successfully' : 'Existing chat retrieved successfully'
      });
    } catch (error) {
      return this.sendErrorResponse(res, error, 'Failed to get or create chat');
    }
  }

  // Send message
  async sendMessage(req, res) {
    try {
      const { chatId } = req.params;
      const { sender, message, outletId, outletName } = req.body;

      // Validation
      if (!sender || !message || !outletId || !outletName) {
        return res.status(400).json({
          success: false,
          message: 'sender, message, outletId, and outletName are required'
        });
      }

      if (!['outlet', 'admin'].includes(sender)) {
        return res.status(400).json({
          success: false,
          message: 'sender must be either "outlet" or "admin"'
        });
      }

      const chatModel = this.getChatModel();

      // Check if chat exists
      const chatExists = await chatModel.chatExists(chatId);
      if (!chatExists) {
        return res.status(404).json({
          success: false,
          message: 'Chat not found'
        });
      }

      const result = await chatModel.sendMessage(chatId, sender, message, outletId, outletName);

      // TODO: Send push notification if sender is admin
      // if (sender === 'admin') {
      //   await this.sendPushNotification({
      //     outletId,
      //     message: `New message from admin: ${message.substring(0, 100)}...`,
      //     type: 'chat_message',
      //     chatId
      //   });
      // }

      return res.status(200).json({
        success: true,
        messageId: result.messageId,
        message: 'Message sent successfully'
      });
    } catch (error) {
      return this.sendErrorResponse(res, error, 'Failed to send message');
    }
  }

  // Get chat messages
  async getChatMessages(req, res) {
    try {
      const { chatId } = req.params;
      const { limit, before } = req.query;

      // Parse limit
      const parsedLimit = limit ? parseInt(limit) : 50;
      if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
        return res.status(400).json({
          success: false,
          message: 'limit must be a number between 1 and 100'
        });
      }

      const chatModel = this.getChatModel();

      // Check if chat exists
      const chatExists = await chatModel.chatExists(chatId);
      if (!chatExists) {
        return res.status(404).json({
          success: false,
          message: 'Chat not found'
        });
      }

      const result = await chatModel.getChatMessages(chatId, parsedLimit, before);

      return res.status(200).json(result);
    } catch (error) {
      return this.sendErrorResponse(res, error, 'Failed to get chat messages');
    }
  }

  // Get all chats (Admin)
  async getAllChats(req, res) {
    try {
      const { limit, startAfter, sortBy } = req.query;

      // Parse and validate parameters
      const parsedLimit = limit ? parseInt(limit) : 20;
      const validSortBy = ['lastMessageTime', 'outletName', 'createdAt'].includes(sortBy) 
        ? sortBy 
        : 'lastMessageTime';

      if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
        return res.status(400).json({
          success: false,
          message: 'limit must be a number between 1 and 100'
        });
      }

      const chatModel = this.getChatModel();
      const result = await chatModel.getAllChats(parsedLimit, startAfter, validSortBy);

      return res.status(200).json(result);
    } catch (error) {
      return this.sendErrorResponse(res, error, 'Failed to get all chats');
    }
  }

  // Mark messages as read
  async markMessagesAsRead(req, res) {
    try {
      const { chatId } = req.params;
      const { messageIds } = req.body;

      // Validation
      if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'messageIds must be a non-empty array'
        });
      }

      const chatModel = this.getChatModel();

      // Check if chat exists
      const chatExists = await chatModel.chatExists(chatId);
      if (!chatExists) {
        return res.status(404).json({
          success: false,
          message: 'Chat not found'
        });
      }

      const result = await chatModel.markMessagesAsRead(chatId, messageIds);

      return res.status(200).json(result);
    } catch (error) {
      return this.sendErrorResponse(res, error, 'Failed to mark messages as read');
    }
  }

  // Get chat details
  async getChatDetails(req, res) {
    try {
      const { chatId } = req.params;

      if (!chatId) {
        return res.status(400).json({
          success: false,
          message: 'chatId is required'
        });
      }

      const chatModel = this.getChatModel();
      const result = await chatModel.getChatDetails(chatId);

      return res.status(200).json(result);
    } catch (error) {
      if (error.message === 'Chat not found') {
        return res.status(404).json({
          success: false,
          message: 'Chat not found'
        });
      }
      return this.sendErrorResponse(res, error, 'Failed to get chat details');
    }
  }

  // Health check endpoint
  async healthCheck(req, res) {
    try {
      const chatModel = this.getChatModel();
      // Simple test to check if Firebase is accessible
      await chatModel.countersCollection.limit(1).get();
      
      return res.status(200).json({
        success: true,
        message: 'Chat service is healthy',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      return this.sendErrorResponse(res, error, 'Chat service is unhealthy');
    }
  }
}

export default new ChatController();
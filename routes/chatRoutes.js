import express from 'express';
import chatController from '../controllers/chatController.js';
const router = express.Router();

// Middleware for request logging (optional)
const logRequest = (req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
};

// Apply logging middleware to all routes
router.use(logRequest);

// Routes

/**
 * @route   POST /api/chats/get-or-create
 * @desc    Get existing chat or create new chat for outlet
 * @body    { outletId: string, outletName: string }
 * @response { success: boolean, chatId: string, message: string }
 */
router.post('/get-or-create', chatController.getOrCreateChat);

/**
 * @route   GET /api/chats
 * @desc    Get all chats (Admin view)
 * @query   { page?: number, limit?: number, sortBy?: string }
 * @response { success: boolean, data: Array, pagination: object }
 */
router.get('/', chatController.getAllChats);

/**
 * @route   GET /api/chats/:chatId
 * @desc    Get chat details
 * @params  chatId
 * @response { success: boolean, data: object }
 */
router.get('/:chatId', chatController.getChatDetails);

/**
 * @route   POST /api/chats/:chatId/messages
 * @desc    Send message to chat
 * @params  chatId
 * @body    { sender: string, message: string, outletId: string, outletName: string }
 * @response { success: boolean, messageId: string, message: string }
 */
router.post('/:chatId/messages', chatController.sendMessage);

/**
 * @route   GET /api/chats/:chatId/messages
 * @desc    Get messages from chat with pagination
 * @params  chatId
 * @query   { limit?: number, before?: string }
 * @response { success: boolean, data: Array, hasMore: boolean }
 */
router.get('/:chatId/messages', chatController.getChatMessages);

/**
 * @route   PUT /api/chats/:chatId/messages/read
 * @desc    Mark messages as read
 * @params  chatId
 * @body    { messageIds: Array<string> }
 * @response { success: boolean, message: string }
 */
router.put('/:chatId/messages/read', chatController.markMessagesAsRead);

// Error handling middleware
router.use((error, req, res, next) => {
  console.error('Chat routes error:', error);
  res.status(500).json({
    success: false,
    message: 'Internal server error'
  });
});

export default router;
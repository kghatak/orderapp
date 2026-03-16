// routes/nannuUserRoutes.js
import express from 'express';
import {
  createNannuUser,
  getAllNannuUsers,
  getNannuUserById,
  updateNannuUser,
  deleteNannuUser,
  getNannuUsersByOutletId,
  updateNannuUserFCMToken
} from '../controllers/nannuUserController.js';

const router = express.Router();

// Nannu User CRUD routes
router.post('/', createNannuUser); // POST /nannu-users - Create Nannu user
router.get('/', getAllNannuUsers); // GET /nannu-users - Get all Nannu users
router.get('/:userId', getNannuUserById); // GET /nannu-users/:userId - Get Nannu user by ID
router.put('/:userId', updateNannuUser); // PUT /nannu-users/:userId - Update Nannu user
router.delete('/:userId', deleteNannuUser); // DELETE /nannu-users/:userId - Delete Nannu user

// Additional Nannu user routes
router.get('/outlet/:outletId', getNannuUsersByOutletId); // GET /nannu-users/outlet/:outletId - Get Nannu users by outlet ID
router.put('/:userId/fcm-token', updateNannuUserFCMToken); // PUT /nannu-users/:userId/fcm-token - Update FCM token for Nannu user

export default router; 
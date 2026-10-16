// routes/authRoutes.js
import express from 'express';
import {
  signup,
  login,
  createOutletStorekeeper,
  listOutletStorekeepers,
  deleteOutletStorekeeper,
} from '../controllers/authController.js';

const authRoutes = express.Router();

// Auth routes
authRoutes.post('/signup', signup);
authRoutes.post('/login', login);
authRoutes.get('/outlet-storekeepers', listOutletStorekeepers);
authRoutes.post('/outlet-storekeeper', createOutletStorekeeper);
authRoutes.delete('/outlet-storekeeper/:id', deleteOutletStorekeeper);

export default authRoutes;

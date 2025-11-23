// routes/authRoutes.js
import express from 'express';
import { signup, login } from '../controllers/authController.js';

const authRoutes = express.Router();

// Auth routes
authRoutes.post('/signup', signup);
authRoutes.post('/login', login);

export default authRoutes;

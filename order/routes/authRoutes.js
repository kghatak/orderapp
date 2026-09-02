// routes/authRoutes.js
import express from 'express';
import { signup, login, outletStorekeeperLogin, outletStorekeeperSignup } from '../controllers/authController.js';

const authRoutes = express.Router();

// Auth routes
authRoutes.post('/signup', signup);
authRoutes.post('/login', login);
authRoutes.post('/outlet-storekeeper/login', outletStorekeeperLogin);
authRoutes.post('/outlet-storekeeper/signup', outletStorekeeperSignup);

export default authRoutes;

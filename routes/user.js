import express from 'express';
import { getUser, getUsers,
    createUser, deleteUser } from '../controllers/user.js'

const userRoutes = express.Router();

userRoutes.get('/', getUsers);
userRoutes.get('/:id', getUser);
userRoutes.post('/', createUser);
userRoutes.delete('/:id', deleteUser);



export default userRoutes;
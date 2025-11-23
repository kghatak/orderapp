import express from 'express';
import { getExam, getExams, createExam, updateExam, deleteExam } from '../controllers/exam.js'
const examRoutes = express.Router();

examRoutes.get('/', getExams);
examRoutes.get('/:id', getExam);

examRoutes.post('/', createExam);
examRoutes.patch('/:id', updateExam);
examRoutes.delete('/:id', deleteExam);

export default examRoutes;
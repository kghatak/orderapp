import express from 'express';
import { getSchools, getSchool, updateSchool, createSchool, deleteSchool, getSchoolNames, getExamCenters } from '../controllers/schools.js'

const schoolRoutes = express.Router();
const schoolNameRoutes = express.Router();
const examCentersRoutes = express.Router();


schoolRoutes.get('/', getSchools);
schoolRoutes.get('/:id', getSchool);

schoolRoutes.post('/', createSchool);
schoolRoutes.patch('/:id', updateSchool);
schoolRoutes.delete('/:id', deleteSchool);

schoolNameRoutes.get('/', getSchoolNames);
examCentersRoutes.get('/', getExamCenters);



export {schoolRoutes, schoolNameRoutes, examCentersRoutes};
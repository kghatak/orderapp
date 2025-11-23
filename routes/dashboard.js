import express from 'express';

import { getRegistrationByExam, getRegistrationBySchool, getRegistrationByZone, 
  getRegistrationBySchoolAsc, getParticipatingSchoolsByZone, 
  getExamCentersByZone } from '../controllers/dashboard.js';


const dashboardRoutes = express.Router();


dashboardRoutes.get('/registrationbyexam/', getRegistrationByExam);
dashboardRoutes.get('/registrationbyschool/', getRegistrationBySchool);
dashboardRoutes.get('/registrationbyschoolAsc/', getRegistrationBySchoolAsc);
dashboardRoutes.get('/registrationbyzone/', getRegistrationByZone);
dashboardRoutes.get('/schoolsbyzone/', getParticipatingSchoolsByZone);
dashboardRoutes.get('/examcenterbyzone/', getExamCentersByZone);

export default dashboardRoutes;

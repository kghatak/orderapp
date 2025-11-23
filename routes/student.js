import express from 'express';

import { 
  getStudent, 
  getStudents, 
  updateStudent, 
  updateStudentClass,
  createStudent, 
  deleteStudent,
  registerStudent,
  removeRegistration,
  getStudentsByZoneAndSchoolCode,
  bulkImportStudentsJSON,
  bulkDeleteStudents  } from '../controllers/student.js'

import { updateRoll }  from '../controllers/roll.js'

const studentRoutes = express.Router();
const studentBySchoolRoutes = express.Router();
const registerRoutes = express.Router();

studentRoutes.get('/', getStudents);
studentRoutes.get('/:id', getStudent);
studentRoutes.post('/', createStudent);
studentRoutes.post('/bulk-import', bulkImportStudentsJSON);
studentRoutes.patch('/:id', updateStudent);
studentRoutes.delete('/bulk-delete', bulkDeleteStudents);
studentRoutes.delete('/:id', deleteStudent);
studentRoutes.patch('/register/:id', registerStudent);
studentRoutes.patch('/remove-registration/:id', removeRegistration);
studentRoutes.put('/update-class', updateStudentClass);
//studentBySchoolRoutes.get('/:id', getStudentsBySchoolCode);
//studentBySchoolRoutes.get('/:zoneID/:schoolID?', getStudentsByZoneAndSchoolCode);
studentBySchoolRoutes.get('/:zoneID/:schoolID?/:class?/:examCode?', getStudentsByZoneAndSchoolCode);

registerRoutes.get('/', updateRoll);
registerRoutes.get('/:id', updateRoll);

export { studentRoutes, registerRoutes, studentBySchoolRoutes } ;
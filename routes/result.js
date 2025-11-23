// export routes based on result controller methods
// Path: routes/result.js
// Compare this snippet from controllers/exam.js:

import express from 'express';
import { getResultByZoneAndSchoolCode, getResults, createResult, updateResult, updateResultBulk, 
          deleteResult, getResultsForSchool,
          getResultsJrGrade, getResultsMidGrade, getResultsSrGrade, getExamCenterAndExamCode, 
          addRank, getResultByRollNumber } from '../controllers/result.js'

const resultRoutes = express.Router();
const resultRoutesJR = express.Router();
resultRoutesJR.use((req, res, next) => {
        req.grade = 'JR';
        next();
});

const resultRoutesMID = express.Router();
resultRoutesMID.use((req, res, next) => {
        req.grade = 'MID';
        next();
});

const resultRoutesSR = express.Router();
resultRoutesSR.use((req, res, next) => {
        req.grade = 'SR';
        next();
});
const examCenterExamCodeRoutes = express.Router();
examCenterExamCodeRoutes.use((req, res, next) => {
        req.grade = 'SR-JR_MID';
        next();
});

const resultbyExamCenterRoutes = express.Router();
resultbyExamCenterRoutes.use((req, res, next) => {
        req.grade = 'RES-SR-JR_MID';
        req.defaultExamCode = 'AVIKSHA2024';
        next();
});

examCenterExamCodeRoutes.get('/', getExamCenterAndExamCode);

resultRoutes.get('/', getResults);
resultRoutes.post('/', createResult);
resultRoutes.patch('/:id', updateResult);
resultRoutes.patch('/addRank/:ExamCode/:StudentCode', addRank);

resultRoutes.patch('/', updateResultBulk);
//resultRoutes.delete('/', deleteResult);
resultRoutes.delete('/:StudentCode/:ExamCode', deleteResult);
resultRoutes.get('/roll/:rollNumber', getResultByRollNumber);
resultRoutes.get('/:schoolCode?/:zone?/:class?/:exam?', getResultsForSchool);
resultRoutes.get('/:schoolCode?/zone/:zone?class/:class?exam/:exam?', getResultsForSchool);


resultRoutesJR.get('/', getResultsJrGrade);
resultRoutesJR.post('/', createResult);
resultRoutesJR.patch('/:id', updateResult);
resultRoutesJR.patch('/', updateResultBulk);
resultRoutesJR.delete('/', deleteResult);

resultRoutesMID.get('/', getResultsMidGrade);
resultRoutesMID.post('/', createResult);
resultRoutesMID.patch('/:id', updateResult);
resultRoutesMID.patch('/', updateResultBulk);
resultRoutesMID.delete('/', deleteResult);

resultRoutesSR.get('/', getResultsSrGrade);
resultRoutesSR.post('/', createResult);
resultRoutesSR.patch('/:id', updateResult);
resultRoutesSR.patch('/', updateResultBulk);
resultRoutesSR.delete('/', deleteResult);

//resultbyExamCenterRoutes.get('/:zoneID/:schoolID?/:class?/:examCode?', getResultByZoneAndSchoolCode)
resultbyExamCenterRoutes.get('/:zoneID/:schoolID?/:schoolName?/:examCode?', getResultByZoneAndSchoolCode)


export { resultRoutes, resultRoutesJR, resultRoutesMID, resultRoutesSR, 
        examCenterExamCodeRoutes, resultbyExamCenterRoutes } ;


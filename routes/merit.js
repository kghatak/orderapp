import express from "express";
import { getMerit, getMerits, updateMerit, createMerit, deleteMerit, downloadMerit } from '../controllers/merit.js'

const app = express();

app.use(express.json())

const meritRoutes = express.Router();

meritRoutes.get('/generate-pdf', downloadMerit);
meritRoutes.get('/', getMerits);
meritRoutes.get('/:id', getMerit);

meritRoutes.post('/', createMerit);
meritRoutes.patch('/:id', updateMerit);
meritRoutes.delete('/:id', deleteMerit);


export default meritRoutes;


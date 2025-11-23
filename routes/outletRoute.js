import express from 'express';
import { createOutlet, getOutletById, updateOutlet, deleteOutlet, getPaginatedOutlets, searchOutlets, getOutletsByStatus } from '../controllers/outlet.js';

const outletRoutes = express.Router();

outletRoutes.post('/', createOutlet);
outletRoutes.get('/', getPaginatedOutlets);
outletRoutes.get('/search', searchOutlets);
outletRoutes.get('/status', getOutletsByStatus);
outletRoutes.get('/:id', getOutletById);
outletRoutes.patch('/:id', updateOutlet);
outletRoutes.delete('/:id', deleteOutlet);

export { outletRoutes };

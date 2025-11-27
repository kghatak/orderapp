import express from 'express';
import { createOutlet, getOutletById, updateOutlet, deleteOutlet, getPaginatedOutlets, searchOutlets, getOutletsByStatus, clearOutletData } from '../controllers/outlet.js';

const outletRoutes = express.Router();

outletRoutes.post('/', createOutlet);
outletRoutes.get('/', getPaginatedOutlets);
outletRoutes.get('/search', searchOutlets);
outletRoutes.get('/status', getOutletsByStatus);
outletRoutes.get('/:id', getOutletById);
outletRoutes.patch('/:id', updateOutlet);
outletRoutes.delete('/:id', deleteOutlet);
outletRoutes.post('/:id/clear-data', clearOutletData); // Clear all outlet data

export { outletRoutes };

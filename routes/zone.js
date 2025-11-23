import express from 'express';

import { getZone, getZones, createZone, updateZone, deleteZone, getLatLngForZone } from '../controllers/zone.js'

const zoneRoutes = express.Router();
const geoCodeRoutes = express.Router();

zoneRoutes.get('/', getZones);
zoneRoutes.get('/:id', getZone);
// write path for createZone
zoneRoutes.post('/', createZone);
// write path for updateZone
zoneRoutes.patch('/:id', updateZone);
// write path for deleteZone
zoneRoutes.delete('/:id', deleteZone);

// Define the route for getting latitude and longitude
geoCodeRoutes.get('/:zoneName', getLatLngForZone);

export { zoneRoutes, geoCodeRoutes };


import express from 'express';
import { milkAuthMiddleware, requireRole } from '../../middleware/milkAuthMiddleware.js';
import { milkTenantMiddleware } from '../../middleware/milkTenantMiddleware.js';
import { listWhatsAppReplies } from '../controllers/whatsappInboundController.js';

const router = express.Router();

router.use(milkAuthMiddleware);
router.use(milkTenantMiddleware);

router.get('/', requireRole('admin', 'supplier'), listWhatsAppReplies);

export default router;

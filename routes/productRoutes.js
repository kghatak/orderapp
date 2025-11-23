import express from 'express';
import {
  createProduct,
  getProductById,
  getAllProducts,
  updateProduct,
  deleteProduct,
  bulkCreateProducts,
  bulkDeleteProducts,
} from '../controllers/productController.js';

const router = express.Router();

router.post('/', createProduct);
router.post('/bulk-upload', bulkCreateProducts);
router.delete('/bulk-delete', bulkDeleteProducts);
router.get('/', getAllProducts);
router.get('/:id', getProductById);
router.put('/:id', updateProduct);
router.delete('/:id', deleteProduct);

export default router;

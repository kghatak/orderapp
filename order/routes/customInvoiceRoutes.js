import express from 'express';
import {
  getAllCustomInvoices,
  createCustomInvoice,
  getCustomInvoice,
  updateCustomInvoice,
  updateInvoiceStatus,
  updateInvoiceDate,
  deleteCustomInvoice
} from '../controllers/customInvoiceController.js';

const customInvoiceRoutes = express.Router();

// GET /custom-invoices - Get all custom invoices with pagination
customInvoiceRoutes.get('/', getAllCustomInvoices);

// POST /custom-invoices - Create new custom invoice
customInvoiceRoutes.post('/', createCustomInvoice);

// GET /custom-invoices/:id - Get specific custom invoice
customInvoiceRoutes.get('/:id', getCustomInvoice);

// PUT /custom-invoices/:id - Update custom invoice
customInvoiceRoutes.put('/:id', updateCustomInvoice);

// PATCH /custom-invoices/:id/status - Update invoice status
customInvoiceRoutes.patch('/:id/status', updateInvoiceStatus);

// PATCH /custom-invoices/:id/date - Update invoice date
customInvoiceRoutes.patch('/:id/date', updateInvoiceDate);

// DELETE /custom-invoices/:id - Delete custom invoice
customInvoiceRoutes.delete('/:id', deleteCustomInvoice);

export default customInvoiceRoutes;

import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import dotenv from 'dotenv';
import { initQueueProcessor } from './pushnotifications/notificationqueueprovider.js'; 

// Load environment variables
dotenv.config();

// Route Imports
import { orderRoutes } from './order/routes/orderRoute.js';
import { outletRoutes } from './order/routes/outletRoute.js';
import productRoutes from './order/routes/productRoutes.js';
import returnRoutes from './order/routes/returns.js';
import storeKeeperRoutes from './order/routes/storeKeepers.js';
import paymentRoutes from './order/routes/paymentRoutes.js';
import utensilRoutes from './order/routes/utensilRoutes.js';
import nannuUserRoutes from './order/routes/nannuUserRoutes.js';
import authRoutes from './order/routes/authRoutes.js';
import { initializeFirestore } from './util/firebase.js';
import { connectMongoDB, isMongoConnected } from './config/db.js';
import { connectOutletPortalMongo, isOutletPortalMongoConnected } from './outlet-portal/config/portalDb.js';
import portalAuthRoutes from './outlet-portal/routes/portalAuthRoutes.js';
import salesRoutes from './outlet-portal/routes/salesRoutes.js';
import expensesRoutes from './outlet-portal/routes/expensesRoutes.js';
import outletProductsRoutes from './outlet-portal/routes/outletProductsRoutes.js';
import wastageRoutes from './outlet-portal/routes/wastageRoutes.js';
import dashboardRoutes from './outlet-portal/routes/dashboardRoutes.js';
import { startDashboardSnapshotCron } from './outlet-portal/jobs/dashboardSnapshotCron.js';
import chatRoutes from './order/routes/chatRoutes.js';
import milkAuthRoutes from './milk/routes/milkAuthRoutes.js';
import supplierRoutes from './milk/routes/supplierRoutes.js';
import procurementRoutes from './milk/routes/procurementRoutes.js';
import milkPaymentRoutes from './milk/routes/milkPaymentRoutes.js';
import milkReportRoutes from './milk/routes/milkReportRoutes.js';
import customInvoiceRoutes from './order/routes/customInvoiceRoutes.js';
//import dailyClosingBalanceRoutes from './routes/dailyClosingBalanceRoutes.js';
import outletOpeningClosingBalanceRoutes from './order/routes/outletOpeningClosingBalanceRoutes.js';

// --- Gemini Setup ---
//import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';

// Constants (replace these with your actual keys/URLs)
const PORT = process.env.PORT || 5020;
//const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// if (!GEMINI_API_KEY) {
//   console.error("❌ GEMINI_API_KEY not provided.");
//   process.exit(1);
// }

// const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
// const model = genAI.getGenerativeModel({
//   model: "gemini-1.5-flash-latest",
//   safetySettings: [
//     {
//       category: HarmCategory.HARM_CATEGORY_HARASSMENT,
//       threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
//     },
//     {
//       category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
//       threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
//     },
//   ],
// });

const app = express();

// CORS: credentials: 'include' from the browser requires a specific Allow-Origin (not *).
// Set CORS_ORIGINS=http://localhost:5174,https://your-prod-domain.com for an explicit list;
// if unset, origin: true reflects the requesting Origin (fine for local dev).
const corsOriginOption = (() => {
  const raw = process.env.CORS_ORIGINS;
  if (!raw?.trim()) return true;
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? list : true;
})();

// Middleware
app.use(cors({ origin: corsOriginOption, credentials: true }));
app.use(bodyParser.json({ limit: '30mb', extended: true }));
app.use(bodyParser.urlencoded({ limit: '30mb', extended: true }));

initQueueProcessor();

await initializeFirestore();
await connectMongoDB(); // Skips gracefully if MongoDB unavailable; Milk module will fail on use
await connectOutletPortalMongo(); // Separate DB connection for outlet portal (OUTLET_PORTAL_MONGODB_URI)

// Route bindings
app.use('/order(s)?', orderRoutes);
app.use('/outlet(s)?', outletRoutes);
app.use('/product(s)?', productRoutes);
app.use('/return(s)?', returnRoutes);
app.use('/payment(s)?', paymentRoutes);
app.use('/storekeeper(s)?', storeKeeperRoutes);
app.use('/utensil(s)?', utensilRoutes);
app.use('/nannu-user(s)?', nannuUserRoutes);
app.use('/auth', authRoutes);
app.use('/chat(s)?', chatRoutes);
app.use('/invoice(s)?', customInvoiceRoutes);
app.use('/outletopeningclosingbalance(s)?', outletOpeningClosingBalanceRoutes);
app.use('/api/balance', outletOpeningClosingBalanceRoutes);

// Outlet portal (Firestore outlet users + separate MongoDB)
app.use('/outlet-portal', (req, res, next) => {
  if (!isOutletPortalMongoConnected()) {
    return res.status(503).json({
      success: false,
      message: 'Outlet portal unavailable. Set OUTLET_PORTAL_MONGODB_URI and ensure MongoDB is reachable.'
    });
  }
  next();
});
app.use('/outlet-portal/auth', portalAuthRoutes);
app.use('/outlet-portal/dashboard', dashboardRoutes);

// Outlet portal sales (MongoDB `sales` collection; requires portal JWT)
const salesMongoGate = (req, res, next) => {
  if (!isOutletPortalMongoConnected()) {
    return res.status(503).json({
      success: false,
      message: 'Outlet portal unavailable. Set OUTLET_PORTAL_MONGODB_URI and ensure MongoDB is reachable.'
    });
  }
  next();
};
for (const salesBase of ['/sales', '/Sales']) {
  app.use(salesBase, salesMongoGate);
  app.use(salesBase, salesRoutes);
}

// Outlet portal expenses (MongoDB; collection name `Expenses`; requires portal JWT)
app.use('/expenses', (req, res, next) => {
  if (!isOutletPortalMongoConnected()) {
    return res.status(503).json({
      success: false,
      message: 'Outlet portal unavailable. Set OUTLET_PORTAL_MONGODB_URI and ensure MongoDB is reachable.'
    });
  }
  next();
});
app.use('/expenses', expensesRoutes);

// Outlet catalog per outlet — MongoDB collection `Products` (requires outlet portal MongoDB)
app.use('/outlet-products', (req, res, next) => {
  if (!isOutletPortalMongoConnected()) {
    return res.status(503).json({
      success: false,
      message: 'Outlet portal unavailable. Set OUTLET_PORTAL_MONGODB_URI and ensure MongoDB is reachable.'
    });
  }
  next();
});
app.use('/outlet-products', outletProductsRoutes);

// Outlet portal wastage — MongoDB collection `Wastages`
app.use('/wastage', (req, res, next) => {
  if (!isOutletPortalMongoConnected()) {
    return res.status(503).json({
      success: false,
      message: 'Outlet portal unavailable. Set OUTLET_PORTAL_MONGODB_URI and ensure MongoDB is reachable.'
    });
  }
  next();
});
app.use('/wastage', wastageRoutes);

// Milk procurement module (MongoDB + tenantId)
app.use('/milk', (req, res, next) => {
  if (!isMongoConnected()) {
    return res.status(503).json({ success: false, message: 'Milk module unavailable. MongoDB not connected.' });
  }
  next();
});
app.use('/milk/auth', milkAuthRoutes);
app.use('/milk/suppliers', supplierRoutes);
app.use('/milk/procurements', procurementRoutes);
app.use('/milk/payments', milkPaymentRoutes);
app.use('/milk/reports', milkReportRoutes);

// Health check
app.get('/', (req, res) => {
  res.json({ status: "API is running!" });
});

// Summarization endpoint using Gemini
app.post('/summarize', async (req, res) => {
  console.log("🔍 Summarization Request Received");
  try {
    const { text } = req.body;

    console.log("📄 Text to summarize:", req.body);

    if (!text || typeof text !== 'string') {
      console.error("❌ Invalid or missing 'text' field in request body.");
      return res.status(400).json({ error: "Invalid or missing 'text' field." });
    }

    const prompt = `Please summarize the following text:\n\n${text}\n\nSummary:`;

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    const candidate = result?.response?.candidates?.[0];
    if (!candidate || !candidate.content?.parts?.length) {
      return res.status(500).json({ error: "No summary returned from Gemini." });
    }

    const summary = candidate.content.parts.map(part => part.text).join("").trim();
    res.json({ summary });

  } catch (error) {
    console.error("❌ Summarization Error:", error);
    res.status(500).json({ error: "Internal server error during summarization." });
  }
});

// Start the server
const startServer = () => {
  const server = app.listen(PORT, () => {
    console.log(`✅ Server running at http://localhost:${PORT}`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`❌ Port ${PORT} is already in use (another Node/nodemon still running on this port).`);
      console.error('   Stop that process, or set PORT in .env to a free port, then restart.');
    } else {
      console.error('❌ Server failed to start:', err);
    }
    process.exit(1);
  });
};

startServer();
startDashboardSnapshotCron();

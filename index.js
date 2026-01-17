import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import dotenv from 'dotenv';
import { initQueueProcessor } from './pushnotifications/notificationqueueprovider.js'; 

// Load environment variables
dotenv.config();

// Route Imports
import { orderRoutes } from './routes/orderRoute.js';
import { outletRoutes } from './routes/outletRoute.js';
import productRoutes from './routes/productRoutes.js';
import returnRoutes from './routes/returns.js';
import storeKeeperRoutes from './routes/storeKeepers.js';
import paymentRoutes from './routes/paymentRoutes.js';
import utensilRoutes from './routes/utensilRoutes.js';
import nannuUserRoutes from './routes/nannuUserRoutes.js';
import authRoutes from './routes/authRoutes.js';
import { initializeFirestore } from './util/firebase.js';
import chatRoutes from './routes/chatRoutes.js';
import customInvoiceRoutes from './routes/customInvoiceRoutes.js';
import dailyClosingBalanceRoutes from './routes/dailyClosingBalanceRoutes.js';
import outletOpeningClosingBalanceRoutes from './routes/outletOpeningClosingBalanceRoutes.js';
import cron from 'node-cron';
import { calculateDailyClosingBalance, backfillClosingBalances } from './controllers/dailyClosingBalanceController.js';

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

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '30mb', extended: true }));
app.use(bodyParser.urlencoded({ limit: '30mb', extended: true }));

initQueueProcessor();

await initializeFirestore();

// Function to calculate daily closing balance (reusable for cron and immediate execution)
const runClosingBalanceCalculation = async () => {
  console.log('📊 Cron job triggered - Calculating daily closing balance...');
  try {
    // Calculate for yesterday (the day that just ended at midnight)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    
    const result = await calculateDailyClosingBalance(yesterday);
    if (result.success) {
      console.log(`✅ Daily closing balance calculation completed successfully for ${result.date}`);
      console.log(`   Processed: ${result.processed} outlets`);
    } else {
      console.error('❌ Daily closing balance calculation failed:', result.error || result.message);
    }
  } catch (error) {
    console.error('❌ Error in daily closing balance cron job:', error);
  }
};

// Run backfill on server start to calculate from starting date (21st November) to today
console.log('🚀 Running backfill on server start to calculate from starting date to today...');
backfillClosingBalances().then(result => {
  if (result.success) {
    console.log(`✅ Backfill completed: ${result.processed} dates processed`);
    console.log('⏰ Daily closing balance cron job scheduled to run at midnight (00:00)');
  } else {
    console.error('❌ Backfill failed:', result.error);
    console.log('⏰ Daily closing balance cron job scheduled to run at midnight (00:00)');
  }
}).catch(error => {
  console.error('❌ Error during backfill:', error);
  console.log('⏰ Daily closing balance cron job scheduled to run at midnight (00:00)');
});

// Setup cron job to run daily closing balance calculation at midnight
// Cron expression: '0 0 * * *' means "at 00:00 (midnight) every day"
cron.schedule('0 0 * * *', runClosingBalanceCalculation, {
  scheduled: true,
  timezone: "Asia/Kolkata"
});

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
app.use('/daily-closing-balance(s)?', dailyClosingBalanceRoutes);
app.use('/outletopeningclosingbalance(s)?', outletOpeningClosingBalanceRoutes);

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
const startServer = async () => {
  try {
    app.listen(PORT, () => {
      console.log(`✅ Server running at http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("❌ Failed to start server:", err.message);
    process.exit(1);
  }
};

startServer();

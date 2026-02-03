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
//import dailyClosingBalanceRoutes from './routes/dailyClosingBalanceRoutes.js';
import outletOpeningClosingBalanceRoutes from './routes/outletOpeningClosingBalanceRoutes.js';

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

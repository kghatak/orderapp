// routes/summarize.js
import express from 'express';
import { OpenAI } from 'openai';

const router = express.Router();

// Get API key from environment variables
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error('Warning: OPENAI_API_KEY environment variable is not set');
}

const openai = new OpenAI({
  apiKey: apiKey
});

router.post('/', async (req, res) => {
  const { text } = req.body;

  if (!text || text.trim().length < 10) {
    return res.status(400).json({ error: 'Text too short to summarize' });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1',
      messages: [
        { role: 'system', content: 'You are a helpful summarizer.' },
        { role: 'user', content: `Summarize the following text:\n\n${text}` },
      ],
      temperature: 0.7,
      max_tokens: 300
    });

    const summary = completion.choices[0]?.message?.content?.trim();
    res.status(200).json({ summary });
  } catch (error) {
    console.error('OpenAI error:', error.message);
    res.status(500).json({ error: 'Failed to summarize text' });
  }
});

export default router;

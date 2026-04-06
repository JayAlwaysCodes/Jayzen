import express from "express";
import dotenv from "dotenv";
import { getOAuthClient } from "./auth.js";
import { getEmails } from "../plugins/gmail.js";
import { getEvents } from "../plugins/calendar.js";
import { reminders } from "./reminders.js";
import cron from "node-cron";

dotenv.config();

export const agentRouter = express.Router();

// Call LLM (Nosana or Ollama)
async function callJayzen(chatMessages) {
  const response = await fetch(`${process.env.OPENAI_API_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.MODEL_NAME,
      messages: chatMessages,
      max_tokens: 2048,
      temperature: 0.7,
    }),
  });

  const text = await response.text();

  // Handle Nosana cold start gracefully
  if (text.includes("<!DOCTYPE") || text.includes("<html") || text.includes("Service Initializing")) {
    return "⏳ Nosana's GPU is warming up. Give it 30 seconds and try again!";
  }

  const data = JSON.parse(text);
  const msg = data.choices[0].message;

  // Qwen3 reasoning mode — content may be null
  if (msg.content) return msg.content;
  if (msg.reasoning) {
    const lines = msg.reasoning.split("\n").filter(l => l.trim());
    return lines[lines.length - 1] || "Done!";
  }

  return "I'm on it. What else do you need?";
}

// Main chat endpoint
agentRouter.post("/chat", async (req, res) => {
  const { message, history = [] } = req.body;

  try {
    const auth = getOAuthClient();
    let contextData = "";
    const lowerMsg = message.toLowerCase();

    // 📧 Fetch emails if needed
    if (lowerMsg.includes("email") || lowerMsg.includes("inbox") || lowerMsg.includes("mail")) {
      const emails = await getEmails(auth, 5);
      contextData += `\n\nRecent emails:\n${JSON.stringify(emails, null, 2)}`;
    }

    // 📅 Fetch calendar events if needed
    if (
      lowerMsg.includes("calendar") ||
      lowerMsg.includes("schedule") ||
      lowerMsg.includes("event") ||
      lowerMsg.includes("meeting") ||
      lowerMsg.includes("planned") ||
      lowerMsg.includes("today")
    ) {
      const events = await getEvents(auth, 5);
      contextData += `\n\nUpcoming calendar events:\n${JSON.stringify(events, null, 2)}`;
    }

    // ⏰ Create reminder if detected
    if (lowerMsg.includes("remind") || lowerMsg.includes("reminder")) {
      const timeMatch = message.match(/(\d{1,2})\s*(am|pm)/i);
      const textMatch = message.match(/remind(?:er)?\s*(?:me\s*)?(?:to\s*)?(.+?)(?:\s*at\s*|\s*by\s*)\d/i);

      if (timeMatch) {
        let hour = parseInt(timeMatch[1]);
        const period = timeMatch[2].toLowerCase();
        if (period === "pm" && hour !== 12) hour += 12;
        if (period === "am" && hour === 12) hour = 0;
        const time = `${String(hour).padStart(2, "0")}:00`;
        const reminderText = textMatch ? textMatch[1].trim() : message;
        const id = Date.now().toString();

        const task = cron.schedule(`0 ${hour} * * *`, () => {
          console.log(`⏰ Reminder fired: ${reminderText}`);
        });

        reminders.push({ id, text: reminderText, time, task });
        contextData += `\n\nReminder successfully created: "${reminderText}" at ${time} daily.`;
        console.log(`⏰ Reminder set: "${reminderText}" at ${time}`);
      }
    }

    const systemPrompt = `You are Jayzen, a personal AI productivity assistant. You help manage Gmail, Google Calendar, and reminders. You are calm, focused, and slightly GenZ — no fluff, just results. Always be concise and helpful.${contextData}`;

    const chatMessages = [
      { role: "system", content: systemPrompt },
      ...history,
      { role: "user", content: message },
    ];

    const reply = await callJayzen(chatMessages);
    res.json({ reply });

  } catch (error) {
    console.error("Agent error:", error.message);
    res.status(500).json({ reply: `Snag: ${error.message}` });
  }
});

import express from "express";
import dotenv from "dotenv";
import { getOAuthClient } from "./auth.js";
import { getEmails, sendEmail } from "../plugins/gmail.js";
import { getEvents, createEvent } from "../plugins/calendar.js";

dotenv.config();

export const agentRouter = express.Router();

// Call Nosana's Qwen model
async function callJayzen(messages) {
  const response = await fetch(`${process.env.OPENAI_API_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.MODEL_NAME,
      messages,
      max_tokens: 2048,
      temperature: 0.7,
    }),
  });

  const text = await response.text();
  console.log("Nosana raw response:", text.substring(0, 300));
  
  // Handle Nosana cold start / downtime
  if (text.includes("<!DOCTYPE") || text.includes("<html")) {
    throw new Error("Nosana endpoint is initializing. Please wait 30 seconds and try again!");
  }
  
  const data = JSON.parse(text);
  const message = data.choices[0].message;
  
  // Qwen3 uses reasoning mode — content may be null, extract from reasoning
  if (message.content) return message.content;
  if (message.reasoning) {
    // Extract final answer after thinking
    const reasoning = message.reasoning;
    const lines = reasoning.split("\n").filter(l => l.trim());
    return lines[lines.length - 1] || "Done!";
  }
  
  // Fallback: try tool_calls or return default
  return "I'm on it. What else do you need?";
}

// Main chat endpoint
agentRouter.post("/chat", async (req, res) => {
  const { message, history = [] } = req.body;

  try {
    const auth = getOAuthClient();
    let contextData = "";

    // Detect intent and fetch relevant data
    const lowerMsg = message.toLowerCase();

    if (lowerMsg.includes("email") || lowerMsg.includes("inbox") || lowerMsg.includes("mail")) {
      const emails = await getEmails(auth, 5);
      contextData = `\n\nRecent emails:\n${JSON.stringify(emails, null, 2)}`;
    }

    if (lowerMsg.includes("calendar") || lowerMsg.includes("schedule") || lowerMsg.includes("event") || lowerMsg.includes("meeting")) {
      const events = await getEvents(auth, 5);
      contextData = `\n\nUpcoming calendar events:\n${JSON.stringify(events, null, 2)}`;
    }

    // Auto-create reminder if detected
    if (lowerMsg.includes("remind") || lowerMsg.includes("reminder")) {
      const timeMatch = message.match(/(\d{1,2})\s*(am|pm)/i);
      const textMatch = message.match(/remind(?:er)?\s*(?:me\s*)?(?:to\s*)?(.+?)(?:\s*at\s*|\s*by\s*)\d/i);
      
      if (timeMatch) {
        let hour = parseInt(timeMatch[1]);
        const period = timeMatch[2].toLowerCase();
        if (period === "pm" && hour !== 12) hour += 12;
        if (period === "am" && hour === 12) hour = 0;
        const time = `${String(hour).padStart(2, "0")}:00`;
        const text = textMatch ? textMatch[1].trim() : message;

        try {
          const { default: cron } = await import("node-cron");
          const { reminders } = await import("./reminders.js");
          
          const id = Date.now().toString();
          const task = cron.schedule(`0 ${hour} * * *`, () => {
            console.log(`⏰ Reminder fired: ${text}`);
          });
          reminders.push({ id, text, time, task });
          contextData += `\n\nReminder successfully created: "${text}" at ${time}`;
        } catch(e) {
          console.error("Reminder creation error:", e.message);
        }
      }
    }

    const systemPrompt = `You are Jayzen, a personal AI productivity assistant. You help manage Gmail, Google Calendar, and reminders. You are calm, focused, and slightly GenZ — no fluff, just results. Always be concise and helpful.${contextData}`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...history,
      { role: "user", content: message },
    ];

    const reply = await callJayzen(messages);
    res.json({ reply });

  } catch (error) {
    console.error("Agent error FULL:", error.message, error.stack);
    res.status(500).json({ 
      reply: `Snag: ${error.message}` 
    });
  }
});

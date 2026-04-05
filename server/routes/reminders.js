import express from "express";
import cron from "node-cron";

export const remindersRouter = express.Router();

// Store reminders in memory
export let reminders = [];
let reminderCallbacks = [];

// Add a reminder
remindersRouter.post("/add", (req, res) => {
  const { text, time } = req.body; // time in HH:MM format
  const [hour, minute] = time.split(":");

  const id = Date.now().toString();

  const task = cron.schedule(`${minute} ${hour} * * *`, () => {
    console.log(`⏰ Reminder: ${text}`);
    reminderCallbacks.forEach(cb => cb({ id, text, time }));
  });

  reminders.push({ id, text, time, task });
  res.json({ success: true, id, text, time });
});

// Get all reminders
remindersRouter.get("/list", (req, res) => {
  res.json(reminders.map(({ id, text, time }) => ({ id, text, time })));
});

// Delete a reminder
remindersRouter.delete("/:id", (req, res) => {
  const { id } = req.params;
  const index = reminders.findIndex(r => r.id === id);
  if (index !== -1) {
    reminders[index].task.stop();
    reminders.splice(index, 1);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: "Reminder not found" });
  }
});

// Register callback for reminder notifications
export const onReminder = (cb) => reminderCallbacks.push(cb);

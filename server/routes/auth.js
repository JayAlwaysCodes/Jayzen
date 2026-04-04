import express from "express";
import { google } from "googleapis";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

export const authRouter = express.Router();

const TOKEN_PATH = "./data/tokens.json";

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Load tokens from disk on startup
export let tokens = null;

try {
  if (fs.existsSync(TOKEN_PATH)) {
    tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
    oauth2Client.setCredentials(tokens);
    console.log("✅ Google tokens loaded from disk");
  }
} catch (e) {
  console.log("No saved tokens found");
}

export const getOAuthClient = () => {
  if (tokens) oauth2Client.setCredentials(tokens);
  return oauth2Client;
};

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
];

authRouter.get("/google", (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });
  res.redirect(url);
});

authRouter.get("/google/callback", async (req, res) => {
  const { code } = req.query;
  try {
    const { tokens: newTokens } = await oauth2Client.getToken(code);
    tokens = newTokens;
    oauth2Client.setCredentials(tokens);

    // Save tokens to disk
    fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
    console.log("✅ Google tokens saved to disk");

    res.redirect("/?auth=success");
  } catch (error) {
    console.error("Auth error:", error);
    res.redirect("/?auth=error");
  }
});

authRouter.get("/status", (req, res) => {
  res.json({ authenticated: !!tokens });
});

authRouter.get("/logout", (req, res) => {
  tokens = null;
  try { fs.unlinkSync(TOKEN_PATH); } catch (e) {}
  res.json({ success: true });
});
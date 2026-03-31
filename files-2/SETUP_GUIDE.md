# 🏠 WhatsApp Property Bot - Complete Setup Guide

This guide will walk you through setting up your automated WhatsApp bot that captures tenant and owner information into Airtable.

---

## 📋 Prerequisites

- A WhatsApp number (for testing)
- A laptop/computer with internet
- 30 minutes of setup time
- Budget: ₹700-1000/month for Twilio + Railway hosting

---

## 🔧 Step 1: Create Airtable Base

### 1.1 Sign up for Airtable
1. Go to https://www.airtable.com
2. Click "Sign up" and create a free account
3. Create a new base called "Property Rental Database"

### 1.2 Create Tenants Table
1. In your base, create a table named **"Tenants"**
2. Add these columns:
   - `Name` (Text)
   - `Phone` (Phone Number)
   - `Configuration` (Single select: 1BHK, 2BHK, 3BHK, etc.)
   - `Furnishing` (Single select: Furnished, Semi-Furnished, Unfurnished)
   - `Locations` (Long text - for multiple locations)
   - `BudgetMin` (Number)
   - `BudgetMax` (Number)
   - `TenantType` (Single select: Bachelor, Family, Student)
   - `MoveInDate` (Date)
   - `ParkingNeeded` (Checkbox)
   - `Pets` (Checkbox)
   - `SpecialRequirements` (Long text)
   - `Confidence` (Number 0-1)
   - `CreatedDate` (Created time - auto)

### 1.3 Create Owners Table
1. Create another table named **"Owners"**
2. Add these columns:
   - `Name` (Text)
   - `Phone` (Phone Number)
   - `Configuration` (Single select: 1BHK, 2BHK, 3BHK, etc.)
   - `Furnishing` (Single select: Furnished, Semi-Furnished, Unfurnished)
   - `Location` (Text)
   - `Rental` (Number - in thousands)
   - `Deposit` (Number - in thousands)
   - `Maintenance` (Number)
   - `Parking` (Single select: 2-wheeler, Car, Both, None)
   - `PetsAllowed` (Checkbox)
   - `MoveInDate` (Date)
   - `OccupancyType` (Single select: Bachelor, Family, Any)
   - `SpecialRestrictions` (Long text)
   - `Confidence` (Number 0-1)
   - `CreatedDate` (Created time - auto)

### 1.4 Get Airtable Credentials
1. Go to https://airtable.com/account/tokens
2. Create a new API token or use your existing one
3. Copy your **API Key** (starts with `pat_`)
4. In your base URL (e.g., https://airtable.com/appXXXXXXXX), copy the **Base ID** (appXXXXXXXX part)

**Save these:**
```
AIRTABLE_BASE_ID = app...
AIRTABLE_API_KEY = pat_...
```

---

## 🔐 Step 2: Set Up Twilio WhatsApp Business API

### 2.1 Create Twilio Account
1. Go to https://www.twilio.com/console
2. Sign up (you'll get ₹300-400 free trial)
3. Verify your phone number

### 2.2 Enable WhatsApp
1. In Twilio Console, go to **Messaging → Try it Out → Send an SMS**
2. Look for "WhatsApp" option, click it
3. Follow the setup wizard to connect your WhatsApp Business Account
4. You'll get a **WhatsApp number** (e.g., `+14155552671`)

### 2.3 Set Up Sandbox (for testing)
1. Go to **Messaging → Try it Out → WhatsApp**
2. Join the sandbox with your personal WhatsApp number
3. You'll receive a message with instructions
4. Reply `join <code>` to enable testing

### 2.4 Get Twilio Credentials
1. In Twilio Console (left sidebar), find:
   - **Account SID** (starts with AC...)
   - **Auth Token** (shown after clicking eye icon)
   - **WhatsApp Number** (from step 2.2)

**Save these:**
```
TWILIO_ACCOUNT_SID = AC...
TWILIO_AUTH_TOKEN = ...
TWILIO_PHONE_NUMBER = whatsapp:+...
```

---

## 🤖 Step 3: Get Anthropic API Key

1. Go to https://console.anthropic.com
2. Sign in or create account
3. Go to **API Keys**
4. Create a new API key
5. Copy it (it starts with `sk-ant-`)

**Save this:**
```
ANTHROPIC_API_KEY = sk-ant-...
```

---

## 🚀 Step 4: Deploy on Railway

Railway is the easiest hosting platform for this bot in India.

### 4.1 Sign Up for Railway
1. Go to https://railway.app
2. Click "Start Project"
3. Sign up with GitHub (recommended) or email
4. Create new project

### 4.2 Deploy the Bot
1. Go to your Railway dashboard
2. Create a new project → "Deploy from GitHub"
3. If you don't have GitHub:
   - Create a GitHub account (free)
   - Create a new repository called "whatsapp-property-bot"
   - Upload the files we created (server.js, package.json, .env.example)
4. Connect the repository to Railway
5. Railway will auto-detect Node.js and deploy

### 4.3 Add Environment Variables
1. In Railway dashboard, go to your project
2. Click on the service → "Variables"
3. Add all these variables:
```
TWILIO_ACCOUNT_SID = [your value from Step 2.4]
TWILIO_AUTH_TOKEN = [your value from Step 2.4]
TWILIO_PHONE_NUMBER = [your value from Step 2.4]
AIRTABLE_BASE_ID = [your value from Step 1.4]
AIRTABLE_API_KEY = [your value from Step 1.4]
ANTHROPIC_API_KEY = [your value from Step 3]
PORT = 3000
NODE_ENV = production
```

### 4.4 Get Your Bot URL
1. Once deployed, Railway gives you a URL (e.g., `https://whatsapp-bot-prod.railway.app`)
2. Copy this URL - you'll need it next

---

## 🔗 Step 5: Connect Twilio Webhook

### 5.1 Set Up Webhook in Twilio
1. Go to Twilio Console → **Messaging → Settings → WhatsApp Sandbox Settings**
2. Find "When a message comes in" field
3. Enter: `https://your-railway-url/webhook` (replace with your actual URL from Step 4.4)
4. Make sure it's set to **POST**
5. Save

---

## ✅ Step 6: Test Your Bot

### 6.1 Send a Test Message
1. From your WhatsApp, message the Twilio WhatsApp sandbox number
2. First join the sandbox (you'll get a code in their reply)
3. Send a tenant inquiry like:
```
Hi, I'm looking for a 2BHK in Koramangala, budget 35k-40k, need by May 1st
```

### 6.2 Check Results
1. Open your Airtable base
2. Go to the "Tenants" table
3. You should see your message automatically parsed and added! ✅

### 6.3 Common Issues & Fixes

| Issue | Fix |
|-------|-----|
| Message not captured | Check Railway logs, make sure webhook URL is correct |
| Airtable error | Verify API key and Base ID in Railway variables |
| Claude extraction fails | Check ANTHROPIC_API_KEY is valid |
| Webhook timeout | Make sure Railway app is running (check status) |

---

## 💰 Cost Breakdown

| Service | Monthly Cost | Notes |
|---------|--------------|-------|
| **Twilio** | ₹300-500 | ~₹0.08/incoming message |
| **Railway** | ₹400-500 | Auto-scales, 5GB free memory |
| **Airtable** | Free | Free tier has 1,200 records limit |
| **Anthropic API** | ₹0-100 | ~₹0.003 per message |
| **Total** | **₹700-1100/month** | Scales with usage |

---

## 📱 Production Tips

### 1. Upgrade from Sandbox
Once tested, upgrade to production WhatsApp Business:
- Go to Twilio → Messaging → WhatsApp
- Upgrade from Sandbox to Production
- You'll get a real WhatsApp number

### 2. Scale Airtable
- Free tier: 1,200 records/month
- Pro tier: Unlimited (₹600/month)
- Upgrade if you exceed limits

### 3. Monitor Costs
- Use Twilio dashboard to track message costs
- Set budget alerts in Railway
- Optimize Claude prompts to reduce tokens

### 4. Backup Data
- Airtable auto-backs up, but export monthly to Excel as backup
- Go to Airtable → Your Base → Download as CSV

---

## 🔄 Advanced Features (Optional)

### Auto-matching Tenants to Owners
Once you have data, we can add:
- Automatic matching (tenant budget = owner rental)
- Automated notifications to both parties
- Follow-up reminders

### Analytics Dashboard
- Add Airtable forms for additional data
- Create views for unmatched tenants/owners
- Set up Airtable automations

---

## 📞 Support

If you get stuck:
1. Check Railway logs: Dashboard → Service → Logs tab
2. Test Twilio webhook: Use ngrok for local testing
3. Verify Airtable schema matches the code

---

**You're all set! Let me know once you've completed each step and I can help debug any issues.** ✅

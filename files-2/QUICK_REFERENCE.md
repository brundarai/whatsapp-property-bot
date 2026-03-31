# 🎯 Quick Reference: All Credentials You Need

Print this out and fill it as you go through setup!

---

## Airtable Setup

**Website:** https://www.airtable.com

| Field | Value |
|-------|-------|
| Base ID | `app_____________` |
| API Key | `pat_____________` |
| Tenants Table Name | `Tenants` |
| Owners Table Name | `Owners` |

---

## Twilio Setup

**Website:** https://www.twilio.com/console

| Field | Value |
|-------|-------|
| Account SID | `AC_____________` |
| Auth Token | `_________________` |
| WhatsApp Number | `whatsapp:+91___________` |

---

## Anthropic API

**Website:** https://console.anthropic.com

| Field | Value |
|-------|-------|
| API Key | `sk-ant-_________________` |

---

## Railway Deployment

**Website:** https://railway.app

| Field | Value |
|-------|-------|
| Project Name | `whatsapp-property-bot` |
| Deployed URL | `https://__________________.railway.app` |
| GitHub Repo | `https://github.com/username/repo` |

---

## Testing Checklist

- [ ] Airtable base created with 2 tables
- [ ] Twilio account verified
- [ ] WhatsApp sandbox joined
- [ ] Anthropic API key created
- [ ] Railway project deployed
- [ ] Environment variables added to Railway
- [ ] Webhook URL configured in Twilio
- [ ] Test message sent and captured in Airtable

---

## Troubleshooting Flowchart

```
Bot not capturing messages?
│
├─→ Check Railway logs (Status = Running?)
│   └─→ If error: Fix and redeploy
│
├─→ Check Twilio webhook (Settings → Webhook URL correct?)
│   └─→ If wrong: Update with Railway URL
│
├─→ Check Airtable (API key valid? Tables exist?)
│   └─→ If error: Regenerate API key
│
└─→ Check Anthropic API key (Valid in Railway env vars?)
    └─→ If error: Update key
```

---

## Cost Monitoring

**Monthly Budget Check:**
- Twilio: Check https://www.twilio.com/console/billing
- Railway: Check https://railway.app/dashboard
- Airtable: Check number of records created

**If costs are too high:**
1. Reduce message frequency
2. Upgrade to Airtable Pro for better limits
3. Optimize Claude extraction (fewer tokens)

---

## Files Included

```
whatsapp-bot/
├── server.js              # Main bot code
├── package.json           # Dependencies
├── .env.example          # Template for env variables
├── SETUP_GUIDE.md        # Detailed setup instructions
└── QUICK_REFERENCE.md    # This file
```

---

## Important Reminders

⚠️ **NEVER share these values:**
- API Keys (Twilio, Airtable, Anthropic)
- Auth Token
- Account SID

💡 **Keep backups of:**
- Your API keys (in a password manager)
- Airtable data (export monthly)
- Railway deployment logs

🔄 **Regular maintenance:**
- Check Railway logs weekly
- Monitor Twilio costs daily
- Clean up duplicate entries in Airtable monthly

---

**Ready to start? Go to SETUP_GUIDE.md and follow Step 1!** ✅

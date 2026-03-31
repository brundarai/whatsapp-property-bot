const express = require('express');
const bodyParser = require('body-parser');
const twilio = require('twilio');
const { google } = require('googleapis');
require('dotenv').config();

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Initialize Twilio client
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER;

// Google Sheets configuration
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_EMAIL;
const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;
const PROJECT_ID = process.env.GOOGLE_PROJECT_ID;
const PRIVATE_KEY_ID = process.env.GOOGLE_PRIVATE_KEY_ID;
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

// Initialize Google Sheets API
const auth = new google.auth.GoogleAuth({
  credentials: {
    type: 'service_account',
    project_id: PROJECT_ID,
    private_key_id: PRIVATE_KEY_ID,
    private_key: PRIVATE_KEY ? PRIVATE_KEY.replace(/\\n/g, '\n') : '',
    client_email: SERVICE_ACCOUNT_EMAIL,
    client_id: CLIENT_ID,
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    token_uri: 'https://oauth2.googleapis.com/token',
    auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

/**
 * Extract data from message
 */
function parseMessage(message) {
  const budget = extractBudget(message);
  
  const data = {
    name: extractValue(message, ['Name', '1.']),
    phone: extractValue(message, ['WhatsApp / Contact Number', 'Contact Number', '2.']),
    requirement: extractValue(message, ['Requirement', '3.']),
    configuration: extractValue(message, ['Configuration', '4.']),
    furnishing: extractValue(message, ['Furnishing', '5.']),
    location: extractValue(message, ['Location', 'Preferred Location', '6.']),
    tenantType: extractValue(message, ['Tenant Type', '7.']),
    budgetRent: budget.rent,
    budgetDeposit: budget.deposit,
    moveInDate: extractValue(message, ['Move-in Date', '9.']),
    parking: extractValue(message, ['Parking', '10.']),
    foodPref: extractValue(message, ['Food Preference', '11.']),
  };
  return data;
}

/**
 * Extract value from message - gets ONLY the answer after the dash
 */
function extractValue(message, keywords) {
  for (const keyword of keywords) {
    const regex = new RegExp(`${keyword}[^–-]*[–-]\\s*([^\\n•]+)`, 'i');
    const match = message.match(regex);
    if (match) {
      let answer = match[1].trim();
      // Remove additional options if present (for single select fields)
      answer = answer.split('/')[0].trim();
      return answer;
    }
  }
  return '';
}

/**
 * Extract budget rent and deposit separately
 */
function extractBudget(message) {
  const rentRegex = /Rent\s*–\s*([^•\n]+)/i;
  const depositRegex = /Deposit\s*–\s*([^•\n]+)/i;
  
  const rentMatch = message.match(rentRegex);
  const depositMatch = message.match(depositRegex);
  
  return {
    rent: rentMatch ? rentMatch[1].trim() : '',
    deposit: depositMatch ? depositMatch[1].trim() : ''
  };
}

/**
 * Add record to Google Sheets
 */
async function addToGoogleSheets(message) {
  try {
    console.log('Starting Google Sheets upload...');

    // Parse message
    const parsedData = parseMessage(message);
    const customerName = parsedData.name || 'Unknown';
    const customerPhone = parsedData.phone || '';

    console.log(`Extracted - Name: ${customerName}, Phone: ${customerPhone}`);
    console.log(`Full data:`, parsedData);

    // Prepare row data - matches your form structure
    const rowData = [
      new Date().toLocaleDateString('en-IN'), // Date
      customerName, // 1. Name
      customerPhone, // 2. WhatsApp / Contact Number
      parsedData.requirement, // 3. Requirement
      parsedData.configuration, // 4. Configuration
      parsedData.furnishing, // 5. Furnishing
      parsedData.location, // 6. Preferred Location
      parsedData.tenantType, // 7. Tenant Type
      parsedData.budgetRent, // 8a. Budget - Rent
      parsedData.budgetDeposit, // 8b. Budget - Deposit
      parsedData.moveInDate, // 9. Expected Move-in Date
      parsedData.parking, // 10. Car Parking Required
      parsedData.foodPref, // 11. Food Preference
      '', // Type (Owner/Tenant) - user fills manually
      '', // Notes
    ];

    console.log('Row data to insert:', rowData);

    // Append to Google Sheets
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'Sheet1!A:O',
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [rowData],
      },
    });

    console.log(`✅ Record added to Google Sheets`);
    return true;
  } catch (error) {
    console.error('Error adding to Google Sheets:', error.message);
    throw error;
  }
}

/**
 * Send WhatsApp message confirmation
 */
async function sendConfirmation(toPhone) {
  const confirmationMsg = `✅ Thanks for your inquiry!\n\nYour information has been saved.\n\nWe'll get back to you soon!`;

  try {
    let fromPhone = TWILIO_PHONE;
    if (fromPhone.startsWith('whatsapp:')) {
      fromPhone = fromPhone.replace('whatsapp:', '');
    }

    await client.messages.create({
      from: `whatsapp:${fromPhone}`,
      to: `whatsapp:${toPhone}`,
      body: confirmationMsg,
    });
    console.log(`Confirmation sent to ${toPhone}`);
  } catch (error) {
    console.error('Error sending confirmation:', error);
  }
}

/**
 * Main webhook endpoint for Twilio
 */
app.post('/webhook', async (req, res) => {
  const messageBody = req.body.Body;
  const fromPhone = req.body.From.replace('whatsapp:', '');
  const senderName = req.body.ProfileName || 'Unknown';

  console.log(`\n📨 New message from ${senderName} (${fromPhone}):\n${messageBody}\n`);

  try {
    if (!messageBody || messageBody.trim().length < 5) {
      res.sendStatus(200);
      return;
    }

    // Add to Google Sheets
    await addToGoogleSheets(messageBody);

    // Send confirmation
    await sendConfirmation(fromPhone);

    res.sendStatus(200);
  } catch (error) {
    console.error('Error processing message:', error);
    res.sendStatus(500);
  }
});

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({ status: 'Bot is running!' });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 WhatsApp bot listening on port ${PORT}`);
});

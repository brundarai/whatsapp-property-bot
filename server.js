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
 * Detect if message is structured form or free-form natural language
 */
function isStructuredForm(message) {
  // Check for numbered format like "1. Name –" or "1. Name -"
  return /^\d+\.\s+\w+\s+[–-]/m.test(message);
}

/**
 * Detect Tenant or Owner from keywords
 */
function detectTypeFromKeywords(message) {
  const lowerMessage = message.toLowerCase();
  
  // Check for explicit mention first
  if (lowerMessage.includes('tenant:') || lowerMessage.match(/^tenant\s/i)) {
    return 'Tenant';
  } else if (lowerMessage.includes('owner:') || lowerMessage.match(/^owner\s/i)) {
    return 'Owner';
  }
  
  // Check for keywords - Tenant
  const tenantKeywords = ['looking for', 'looking', 'need', 'seeking', 'want', 'search', 'require', 'budget', 'searching'];
  
  // Check for keywords - Owner
  const ownerKeywords = ['property', 'listing', 'available', 'for rent', 'rental', 'lease', 'let out', 'have a', 'own a'];
  
  let tenantCount = 0;
  let ownerCount = 0;
  
  tenantKeywords.forEach(keyword => {
    if (lowerMessage.includes(keyword)) tenantCount++;
  });
  
  ownerKeywords.forEach(keyword => {
    if (lowerMessage.includes(keyword)) ownerCount++;
  });
  
  console.log(`Type detection - Tenant keywords: ${tenantCount}, Owner keywords: ${ownerCount}`);
  
  // Default to Tenant if Tenant keywords found, otherwise Owner
  return tenantCount > ownerCount ? 'Tenant' : 'Owner';
}

/**
 * Extract value from structured form message
 */
function extractValueStructured(message, keywords) {
  for (const keyword of keywords) {
    const regex = new RegExp(`${keyword}[^–-]*[–-]\\s*([^\\n•]+)`, 'i');
    const match = message.match(regex);
    if (match) {
      let answer = match[1].trim();
      answer = answer.split('/')[0].trim();
      return answer;
    }
  }
  return '';
}

/**
 * Extract budget from structured form
 */
function extractBudgetStructured(message) {
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
 * Extract data from free-form natural language message
 */
function extractFromNaturalLanguage(message) {
  // Remove "Tenant:" or "Owner:" prefix if present
  let cleanMessage = message.replace(/^(tenant|owner):\s*/i, '');
  
  const data = {
    // Extract name - look for patterns like "I'm [name]" or "this is [name]" or "name is [name]"
    name: extractName(cleanMessage),
    
    // Extract phone - look for 10 digit numbers
    phone: extractPhone(cleanMessage),
    
    // Extract configuration - look for "1BHK", "2BHK", "3BHK", "4BHK", etc.
    configuration: extractConfiguration(cleanMessage),
    
    // Extract location - look for "in [location]" or "at [location]"
    location: extractLocation(cleanMessage),
    
    // Extract budget - look for "budget of", "₹", "k", etc.
    budgetRent: extractBudget(cleanMessage),
    budgetDeposit: '',
    
    // Extract move-in date - look for date patterns
    moveInDate: extractMoveInDate(cleanMessage),
    
    // Extract parking - look for "parking", "car", "vehicle"
    parking: extractParking(cleanMessage),
    
    requirement: 'Rent',
    furnishing: '',
    tenantType: '',
    foodPref: '',
  };
  
  return data;
}

/**
 * Extract name from natural language
 */
function extractName(message) {
  // Try "Brunda here" or "[name] here" (at start)
  let match = message.match(/^[A-Za-z]+,?\s+([A-Za-z]+)\s+here/i);
  if (match) return match[1].trim();
  
  // Try "I'm [name]" or "this is [name]" or "[name] here"
  match = message.match(/(?:I'm|this is|I am|name is|hello|hi)\s+([A-Za-z\s]+?)(?:\s+(?:here|from|and|i'm|looking|need)|\.|$)/i);
  if (match) return match[1].trim();
  
  // Try just "[Name] here"
  match = message.match(/\b([A-Z][a-z]+)\s+here\b/i);
  if (match) return match[1].trim();
  
  // Try at start of message (first capitalized word)
  match = message.match(/^([A-Z][a-z]+)/);
  if (match) return match[1].trim();
  
  return '';
}

/**
 * Extract phone number from natural language
 */
function extractPhone(message) {
  // Look for 10 digit number
  const match = message.match(/\b(\d{10})\b/);
  return match ? match[1] : '';
}

/**
 * Extract configuration (BHK) from natural language
 */
function extractConfiguration(message) {
  // Look for "2 BHK", "2BHK", "3 bhk", etc.
  const match = message.match(/(\d+\s*bhk|\d+bhk)/i);
  return match ? match[1].replace(/\s+/g, '').toUpperCase() : '';
}

/**
 * Extract location from natural language
 */
function extractLocation(message) {
  // Look for "in [location]" or "at [location]"
  let match = message.match(/(?:in|at|near|around)\s+([A-Za-z\s]+?)(?:\s+(?:with|and|budget|having|need|want|will)|,|$)/i);
  if (match) return match[1].trim();
  
  // Look for location after BHK mention
  match = message.match(/\d+\s*bhk\s+(?:in|at|near)\s+([A-Za-z\s]+?)(?:\s|,|$)/i);
  if (match) return match[1].trim();
  
  // Look for capitalized words (potential location names)
  match = message.match(/(?:in|at|near)\s+([A-Z][a-z]+)/i);
  if (match) return match[1].trim();
  
  return '';
}

/**
 * Extract budget from natural language
 */
function extractBudget(message) {
  // Look for "budget of 45k", "45k budget", "₹45000", "20-25k", etc.
  let match = message.match(/budget\s+(?:of\s+)?([0-9.k-]+)/i);
  if (match) return match[1].trim();
  
  match = message.match(/₹\s*([0-9,]+)/);
  if (match) return match[1].trim();
  
  match = message.match(/([0-9]+-?[0-9]*k)\b/i);
  if (match) return match[1].trim();
  
  match = message.match(/([0-9,]+)\s*(?:budget|per month|pm)/i);
  if (match) return match[1].trim();
  
  return '';
}

/**
 * Extract move-in date from natural language
 */
function extractMoveInDate(message) {
  // Look for "move in by", "by [date]", "from [date]", "on [date]"
  let match = message.match(/(?:move\s+in\s+by|by|from|on)\s+([A-Za-z\s0-9]+?)(?:\s+(?:and|with|budget)|\.|$)/i);
  if (match) return match[1].trim();
  
  return '';
}

/**
 * Extract parking from natural language
 */
function extractParking(message) {
  const lowerMessage = message.toLowerCase();
  
  if (lowerMessage.includes('parking') || lowerMessage.includes('car')) {
    if (lowerMessage.includes('no') || lowerMessage.includes('without')) {
      return 'No';
    }
    return 'Yes';
  }
  
  return '';
}

/**
 * Parse message - handles both structured form and natural language
 */
function parseMessage(message) {
  let data;
  
  if (isStructuredForm(message)) {
    // Handle structured form
    const budget = extractBudgetStructured(message);
    data = {
      type: detectTypeFromKeywords(message),
      name: extractValueStructured(message, ['Name', '1.']),
      phone: extractValueStructured(message, ['WhatsApp / Contact Number', 'Contact Number', '2.']),
      requirement: extractValueStructured(message, ['Requirement', '3.']),
      configuration: extractValueStructured(message, ['Configuration', '4.']),
      furnishing: extractValueStructured(message, ['Furnishing', '5.']),
      location: extractValueStructured(message, ['Location', 'Preferred Location', '6.']),
      tenantType: extractValueStructured(message, ['Tenant Type', 'Occupancy Type', '7.']),
      budgetRent: budget.rent,
      budgetDeposit: budget.deposit,
      moveInDate: extractValueStructured(message, ['Move-in Date', '9.']),
      parking: extractValueStructured(message, ['Parking', '10.']),
      foodPref: extractValueStructured(message, ['Food Preference', '11.']),
    };
  } else {
    // Handle natural language
    data = extractFromNaturalLanguage(message);
    data.type = detectTypeFromKeywords(message);
  }
  
  return data;
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
    const sheetName = parsedData.type === 'Owner' ? 'Owner' : 'Tenant';

    console.log(`Detected Type: ${parsedData.type}`);
    console.log(`Sheet: ${sheetName}`);
    console.log(`Extracted - Name: ${customerName}, Phone: ${customerPhone}`);
    console.log(`Full extracted data:`, parsedData);

    // Prepare row data
    const rowData = [
      new Date().toLocaleDateString('en-IN'),
      customerName,
      customerPhone,
      parsedData.requirement,
      parsedData.configuration,
      parsedData.furnishing,
      parsedData.location,
      parsedData.tenantType,
      parsedData.budgetRent,
      parsedData.budgetDeposit,
      parsedData.moveInDate,
      parsedData.parking,
      parsedData.foodPref,
      '',
    ];

    console.log('Row data to insert:', rowData);

    // Append to appropriate sheet
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${sheetName}!A:N`,
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [rowData],
      },
    });

    console.log(`✅ Record added to ${sheetName} sheet`);
    return true;
  } catch (error) {
    console.error('Error adding to Google Sheets:', error.message);
    throw error;
  }
}

/**
 * Send WhatsApp message confirmation
 */
async function sendConfirmation(toPhone, type) {
  const confirmationMsg = `✅ Thanks for your inquiry!\n\nYour ${type.toLowerCase()} information has been saved.\n\nWe'll get back to you soon!`;

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

    // Parse to get type
    const parsedData = parseMessage(messageBody);

    // Add to Google Sheets
    await addToGoogleSheets(messageBody);

    // Send confirmation
    await sendConfirmation(fromPhone, parsedData.type);

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

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
 * Detect message format type
 */
function detectMessageFormat(message) {
  // Check for numbered format like "1. Name –" or "1. Name -"
  if (/^\d+\.\s+\w+\s+[–-]/m.test(message)) {
    return 'numbered';
  }
  
  // Check for key-value format like "Name - value" or "Budget - value"
  if (/^[A-Za-z\s]+-\s+/m.test(message)) {
    return 'keyvalue';
  }
  
  // Default to natural language
  return 'natural';
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
 * Extract from key-value format
 * Format: "Budget - 30 to 35 including maintenance"
 */
function extractFromKeyValue(message) {
  console.log('Extracting from KEY-VALUE format');
  
  const lines = message.split('\n');
  const keyValueMap = {};
  const extraNotes = [];
  
  lines.forEach(line => {
    line = line.trim();
    if (!line) return;
    
    // Match "Key - Value" or "Key - " format
    const match = line.match(/^([A-Za-z\s]+?)\s*-\s*(.*)$/);
    
    if (match) {
      const key = match[1].trim().toLowerCase();
      const value = match[2].trim();
      keyValueMap[key] = value;
      console.log(`Found: ${key} = ${value}`);
    } else {
      // Line doesn't have a key, treat as extra note
      extraNotes.push(line);
      console.log(`Extra note: ${line}`);
    }
  });
  
  // Extract specific fields
  const data = {
    name: keyValueMap['sreeraj'] || keyValueMap['name'] || '',
    phone: extractPhoneFromString(keyValueMap['sreeraj'] || keyValueMap['phone'] || ''),
    location: keyValueMap['location'] || keyValueMap['preferred location'] || '',
    budgetRent: keyValueMap['budget'] || '',
    budgetDeposit: '',
    requirement: 'Rent',
    configuration: '',
    furnishing: '',
    tenantType: '',
    moveInDate: '',
    parking: '',
    foodPref: '',
    notes: buildNotes(keyValueMap, extraNotes),
  };
  
  return data;
}

/**
 * Extract phone number from a string
 */
function extractPhoneFromString(str) {
  if (!str) return '';
  
  // Look for "+91 98809 37953" format with spaces
  let match = str.match(/\+91\s*(\d{5})\s*(\d{5})/);
  if (match) return `${match[1]}${match[2]}`;
  
  // Look for "+91 9880937953" format
  match = str.match(/\+91\s*(\d{10})/);
  if (match) return match[1];
  
  // Look for just "98809 37953" (without +91)
  match = str.match(/\b(\d{5})\s+(\d{5})\b/);
  if (match) return `${match[1]}${match[2]}`;
  
  // Look for 10 digit number
  match = str.match(/\b(\d{10})\b/);
  if (match) return match[1];
  
  return '';
}

/**
 * Build notes from extra fields
 */
function buildNotes(keyValueMap, extraLines) {
  const notesParts = [];
  
  // Add fields that don't fit into main columns
  if (keyValueMap['work location']) {
    notesParts.push(`Work Location: ${keyValueMap['work location']}`);
  }
  if (keyValueMap['notes']) {
    notesParts.push(`Notes: ${keyValueMap['notes']}`);
  }
  
  // Add extra lines
  extraLines.forEach(line => {
    notesParts.push(line);
  });
  
  return notesParts.join('; ');
}

/**
 * Extract value from numbered format
 */
function extractValueNumbered(message, keywords) {
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
 * Extract budget from numbered format
 */
function extractBudgetNumbered(message) {
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
 * Extract from natural language
 */
function extractFromNaturalLanguage(message) {
  console.log('Extracting from NATURAL LANGUAGE format');
  
  let cleanMessage = message.replace(/^(tenant|owner):\s*/i, '');
  
  const data = {
    name: extractName(cleanMessage),
    phone: extractPhone(cleanMessage),
    configuration: extractConfiguration(cleanMessage),
    location: extractLocation(cleanMessage),
    budgetRent: extractBudget(cleanMessage),
    budgetDeposit: '',
    requirement: 'Rent',
    furnishing: '',
    tenantType: '',
    moveInDate: extractMoveInDate(cleanMessage),
    parking: extractParking(cleanMessage),
    foodPref: '',
    notes: '',
  };
  
  return data;
}

/**
 * Extract from numbered format
 */
function extractFromNumbered(message) {
  console.log('Extracting from NUMBERED format');
  
  const budget = extractBudgetNumbered(message);
  const data = {
    name: extractValueNumbered(message, ['Name', '1.']),
    phone: extractValueNumbered(message, ['WhatsApp / Contact Number', 'Contact Number', '2.']),
    requirement: extractValueNumbered(message, ['Requirement', '3.']),
    configuration: extractValueNumbered(message, ['Configuration', '4.']),
    furnishing: extractValueNumbered(message, ['Furnishing', '5.']),
    location: extractValueNumbered(message, ['Location', 'Preferred Location', '6.']),
    tenantType: extractValueNumbered(message, ['Tenant Type', 'Occupancy Type', '7.']),
    budgetRent: budget.rent,
    budgetDeposit: budget.deposit,
    moveInDate: extractValueNumbered(message, ['Move-in Date', '9.']),
    parking: extractValueNumbered(message, ['Parking', '10.']),
    foodPref: extractValueNumbered(message, ['Food Preference', '11.']),
    notes: '',
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
  
  // Try "[Name] - +phone" or "[Name] +phone" format
  match = message.match(/^([A-Za-z]+)\s*-\s*\+?\d+/i);
  if (match) return match[1].trim();
  
  // Try line with name before phone
  match = message.match(/([A-Za-z]+)\s*-\s*\+91\s*\d+/i);
  if (match) return match[1].trim();
  
  // Try "I'm [name]" or "this is [name]"
  match = message.match(/(?:I'm|this is|I am|name is)\s+([A-Za-z\s]+?)(?:\s+(?:here|from|and|i'm|looking|need)|\.|$)/i);
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
 * Extract phone from natural language
 */
function extractPhone(message) {
  return extractPhoneFromString(message);
}

/**
 * Extract configuration (BHK)
 */
function extractConfiguration(message) {
  const match = message.match(/(\d+\s*bhk|\d+bhk)/i);
  return match ? match[1].replace(/\s+/g, '').toUpperCase() : '';
}

/**
 * Extract location from natural language
 */
function extractLocation(message) {
  let match = message.match(/(?:in|at|near|around)\s+([A-Za-z\s]+?)(?:\s+(?:with|and|budget|having|need|want|will)|\n|,|$)/i);
  if (match) return match[1].trim();
  
  match = message.match(/\d+\s*bhk\s+(?:in|at|near)\s+([A-Za-z\s]+?)(?:\s|\n|,|$)/i);
  if (match) return match[1].trim();
  
  match = message.match(/(?:in|at|near)\s+([A-Z][a-z]+)/i);
  if (match) return match[1].trim();
  
  return '';
}

/**
 * Extract budget
 */
function extractBudget(message) {
  let match = message.match(/budget\s*-\s*([0-9]+\s+to\s+[0-9]+[k]?(?:\s+including\s+\w+)?)/i);
  if (match) return match[1].trim();
  
  match = message.match(/budget\s+(?:of\s+)?([0-9.k-]+)/i);
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
 * Extract move-in date
 */
function extractMoveInDate(message) {
  let match = message.match(/(?:move\s+in\s+by|by|from|on)\s+([A-Za-z\s0-9]+?)(?:\s+(?:and|with|budget)|\.|$)/i);
  if (match) return match[1].trim();
  
  return '';
}

/**
 * Extract parking
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
 * Parse message - handles all three formats
 */
function parseMessage(message) {
  const format = detectMessageFormat(message);
  let data;
  
  console.log(`Detected format: ${format}`);
  
  if (format === 'numbered') {
    data = extractFromNumbered(message);
  } else if (format === 'keyvalue') {
    data = extractFromKeyValue(message);
  } else {
    data = extractFromNaturalLanguage(message);
  }
  
  // Add type detection
  data.type = detectTypeFromKeywords(message);
  
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
      parsedData.notes,
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
 * Send WhatsApp confirmation
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
 * Main webhook
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
 * Health check
 */
app.get('/health', (req, res) => {
  res.json({ status: 'Bot is running!' });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 WhatsApp bot listening on port ${PORT}`);
});

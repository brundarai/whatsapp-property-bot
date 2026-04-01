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
 * Parse message into structured data intelligently
 */
function smartExtractData(message) {
  console.log('🧠 Smart extraction starting...');
  
  const data = {
    name: '',
    phone: '',
    type: 'Tenant',
    requirement: 'Rent',
    configuration: '',
    furnishing: '',
    location: '',
    tenantType: '',
    budgetRent: '',
    budgetDeposit: '',
    moveInDate: '',
    parking: '',
    foodPref: '',
    notes: [],
  };

  const lines = message.split('\n').map(l => l.trim()).filter(l => l);
  const keyValuePairs = {};
  const freeTextLines = [];

  console.log(`Processing ${lines.length} lines...`);

  // Parse lines into key-value pairs or free text
  lines.forEach((line, idx) => {
    console.log(`Line ${idx}: "${line}"`);
    
    // Try to match "Key - Value" format
    const kvMatch = line.match(/^([^-]+?)\s*-\s*(.+)$/);
    
    if (kvMatch) {
      const key = kvMatch[1].trim().toLowerCase();
      const value = kvMatch[2].trim();
      keyValuePairs[key] = value;
      console.log(`  → Key-Value: ${key} = ${value}`);
    } else {
      // Free text line
      freeTextLines.push(line);
      console.log(`  → Free text: ${line}`);
    }
  });

  console.log('Key-Value pairs:', keyValuePairs);

  // Extract name - try multiple approaches
  // 1. Check if there's a key like "sreeraj" (name mentioned as key)
  const nameKeys = Object.keys(keyValuePairs).filter(k => 
    !k.includes('location') && !k.includes('budget') && !k.includes('work') && 
    !k.includes('radius') && !k.includes('preference') && k.length > 2
  );
  
  if (nameKeys.length > 0 && keyValuePairs[nameKeys[0]].match(/\d/)) {
    // This key has a phone number attached, so the key is likely the name
    data.name = nameKeys[0].split(' ')[0]; // Get first part
    if (nameKeys[0].includes(' ')) {
      data.name = nameKeys[0]; // Full name if multiple words
    }
    const phoneStr = keyValuePairs[nameKeys[0]];
    data.phone = extractPhone(phoneStr);
    console.log(`Found name from key-value: ${data.name}`);
  } else {
    // Try to extract from free text or other patterns
    const nameMatch = message.match(/([A-Z][a-z]+)\s*-\s*\+91/i);
    if (nameMatch) {
      data.name = nameMatch[1];
      console.log(`Found name before phone: ${data.name}`);
    }
  }

  // Extract phone number from message
  if (!data.phone) {
    data.phone = extractPhone(message);
  }
  console.log(`Extracted phone: ${data.phone}`);

  // Extract location
  data.location = keyValuePairs['location'] || keyValuePairs['preferred location'] || '';
  console.log(`Extracted location: ${data.location}`);

  // Extract budget
  const budgetKey = Object.keys(keyValuePairs).find(k => k.includes('budget'));
  if (budgetKey) {
    data.budgetRent = keyValuePairs[budgetKey];
  }
  console.log(`Extracted budget: ${data.budgetRent}`);

  // Extract work location
  const workLocKey = Object.keys(keyValuePairs).find(k => k.includes('work'));
  if (workLocKey) {
    data.notes.push(`Work Location: ${keyValuePairs[workLocKey]}`);
  }

  // Extract other notes
  const notesKey = Object.keys(keyValuePairs).find(k => k.includes('notes'));
  if (notesKey) {
    data.notes.push(keyValuePairs[notesKey]);
  }

  // Collect free text as additional notes
  freeTextLines.forEach(line => {
    if (!line.match(/^[a-z\s:]+$/i) || line.length > 5) {
      data.notes.push(line);
    }
  });

  // Detect type from keywords
  const lowerMsg = message.toLowerCase();
  if (lowerMsg.includes('looking for') || lowerMsg.includes('need') || lowerMsg.includes('want')) {
    data.type = 'Tenant';
  } else if (lowerMsg.includes('property') || lowerMsg.includes('listing') || lowerMsg.includes('available')) {
    data.type = 'Owner';
  }

  data.notes = data.notes.join('; ');
  console.log('Final extracted data:', data);
  
  return data;
}

/**
 * Extract phone number from string
 */
function extractPhone(str) {
  if (!str) return '';
  
  // Remove "whatsapp:" prefix if present
  str = str.replace('whatsapp:', '');
  
  // Look for "+91 98809 37953" format with spaces
  let match = str.match(/\+91\s*(\d{5})\s*(\d{5})/);
  if (match) {
    console.log(`Found phone with spaces: +91 ${match[1]} ${match[2]}`);
    return `${match[1]}${match[2]}`;
  }
  
  // Look for "+91 9880937953" format
  match = str.match(/\+91\s*(\d{10})/);
  if (match) {
    console.log(`Found phone +91: ${match[1]}`);
    return match[1];
  }
  
  // Look for "98809 37953" (without +91, with space)
  match = str.match(/\b(\d{5})\s+(\d{5})\b/);
  if (match) {
    console.log(`Found phone no +91: ${match[1]}${match[2]}`);
    return `${match[1]}${match[2]}`;
  }
  
  // Look for 10 digit number directly
  match = str.match(/\b(\d{10})\b/);
  if (match) {
    console.log(`Found 10 digit phone: ${match[1]}`);
    return match[1];
  }
  
  return '';
}

/**
 * Add record to Google Sheets
 */
async function addToGoogleSheets(message) {
  try {
    console.log('Starting Google Sheets upload...');

    // Smart extract data
    const parsedData = smartExtractData(message);

    const customerName = parsedData.name || 'Unknown';
    const customerPhone = parsedData.phone || '';
    const sheetName = parsedData.type === 'Owner' ? 'Owner' : 'Tenant';

    console.log(`\n✅ Extracted Data:`);
    console.log(`   Name: ${customerName}`);
    console.log(`   Phone: ${customerPhone}`);
    console.log(`   Type: ${parsedData.type}`);
    console.log(`   Location: ${parsedData.location}`);
    console.log(`   Budget: ${parsedData.budgetRent}`);
    console.log(`   Sheet: ${sheetName}\n`);

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
    return { success: true, data: parsedData, sheetName };

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
    console.log(`✅ Confirmation sent to ${toPhone}`);
  } catch (error) {
    console.error('Error sending confirmation:', error.message);
    // Don't throw - continue even if confirmation fails
  }
}

/**
 * Main webhook
 */
app.post('/webhook', async (req, res) => {
  const messageBody = req.body.Body;
  const fromPhone = req.body.From.replace('whatsapp:', '');
  const senderName = req.body.ProfileName || 'Unknown';

  console.log(`\n📨 New message from ${senderName} (${fromPhone}):`);
  console.log(`\n${messageBody}\n`);

  try {
    if (!messageBody || messageBody.trim().length < 5) {
      console.log('⚠️  Message too short, ignoring');
      res.sendStatus(200);
      return;
    }

    // Extract data using smart extraction
    const result = await addToGoogleSheets(messageBody);

    // Send confirmation
    await sendConfirmation(fromPhone, result.data.type || 'Tenant');

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
  res.json({ status: 'Bot is running!', extraction: 'smart' });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 WhatsApp bot listening on port ${PORT}`);
  console.log(`🧠 Smart extraction: ENABLED (No API calls)\n`);
});
